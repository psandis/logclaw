import { RuntimeLogclawConfig } from "../config.js";
import { LogEntry, LogFormat, normalizeLevel } from "./types.js";

// ---------------------------------------------------------------------------
// Each parser takes a single source line + its line number and returns a
// normalized LogEntry. They assume the format has already been detected;
// detect.ts is responsible for choosing which one to run.
// ---------------------------------------------------------------------------

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (k in obj && obj[k] != null) return obj[k];
  }
  return undefined;
}

function coerceDate(value: unknown): Date | undefined {
  if (value == null) return undefined;
  if (typeof value === "number") {
    // Heuristic: seconds vs milliseconds.
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? undefined : d;
  }
  if (typeof value === "string") {
    const parsed = parseTimestampString(value);
    if (parsed) return parsed;
  }
  return undefined;
}

function parseTimestampString(value: string): Date | undefined {
  const isoNaive = value.match(
    /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})[T\s](?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.(?<ms>\d{1,3}))?$/,
  );
  if (isoNaive?.groups) {
    return utcDateFromParts(isoNaive.groups);
  }

  const slashNaive = value.match(
    /^(?<year>\d{4})\/(?<month>\d{2})\/(?<day>\d{2})\s(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})$/,
  );
  if (slashNaive?.groups) {
    return utcDateFromParts(slashNaive.groups);
  }

  const common = value.match(
    /^(?<day>\d{2})\/(?<month>[A-Za-z]{3})\/(?<year>\d{4}):(?<time>\d{2}:\d{2}:\d{2})\s+(?<offset>[+-]\d{4})$/,
  );
  if (common?.groups) {
    const time = common.groups.time;
    const monthName = common.groups.month;
    const offset = common.groups.offset;
    if (!time || !monthName || !offset) return undefined;

    const [hour, minute, second] = time.split(":").map(Number);
    const month = monthIndex(monthName);
    if (month !== undefined) {
      const utc = Date.UTC(
        Number(common.groups.year),
        month,
        Number(common.groups.day),
        hour,
        minute,
        second,
      );
      return new Date(utc - parseOffsetMinutes(offset) * 60_000);
    }
  }

  const apacheError = value.match(
    /^(?:[A-Za-z]{3}\s)?(?<month>[A-Za-z]{3})\s+(?<day>\d{1,2})\s+(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.(?<fraction>\d{1,6}))?\s+(?<year>\d{4})$/,
  );
  if (apacheError?.groups) {
    const monthName = apacheError.groups.month;
    if (!monthName) return undefined;

    const month = monthIndex(monthName);
    if (month !== undefined) {
      return new Date(
        Date.UTC(
          Number(apacheError.groups.year),
          month,
          Number(apacheError.groups.day),
          Number(apacheError.groups.hour),
          Number(apacheError.groups.minute),
          Number(apacheError.groups.second),
          Number((apacheError.groups.fraction ?? "0").slice(0, 3).padEnd(3, "0")),
        ),
      );
    }
  }

  const syslog = value.match(
    /^(?<month>[A-Z][a-z]{2})\s+(?<day>\d{1,2})\s+(?<time>\d{2}:\d{2}:\d{2})$/,
  );
  if (syslog?.groups) {
    const time = syslog.groups.time;
    const monthName = syslog.groups.month;
    if (!time || !monthName) return undefined;

    const [hour, minute, second] = time.split(":").map(Number);
    const month = monthIndex(monthName);
    if (month !== undefined) {
      const year = new Date().getUTCFullYear();
      return new Date(
        Date.UTC(year, month, Number(syslog.groups.day), hour, minute, second),
      );
    }
  }

  const direct = new Date(value);
  if (!isNaN(direct.getTime())) return direct;

  return undefined;
}

export function parseJsonLine(
  line: string,
  lineNo: number,
  config: RuntimeLogclawConfig,
): LogEntry {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return parseRawLine(line, lineNo, config);
  }

  const levelKeys = config.parsers.fieldMappings.level;
  const messageKeys = config.parsers.fieldMappings.message;
  const timeKeys = config.parsers.fieldMappings.timestamp;

  const level = normalizeLevel(asString(pick(obj, levelKeys)), config.levelAliasMap);
  const message = asString(pick(obj, messageKeys)) ?? "";
  const timestamp = coerceDate(pick(obj, timeKeys));

  // Everything not consumed above becomes an extra field.
  const consumed = new Set([...levelKeys, ...messageKeys, ...timeKeys]);
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!consumed.has(k)) fields[k] = v;
  }

  return { raw: line, lineNo, level, message, timestamp, fields };
}

export function parseLogfmtLine(
  line: string,
  lineNo: number,
  config: RuntimeLogclawConfig,
): LogEntry {
  const fields = parseLogfmtPairs(line);
  const levelKeys = config.parsers.fieldMappings.level;
  const messageKeys = config.parsers.fieldMappings.message;
  const timeKeys = config.parsers.fieldMappings.timestamp;

  const level = normalizeLevel(asString(pick(fields, levelKeys)), config.levelAliasMap);
  const message = asString(pick(fields, messageKeys)) ?? line;
  const timestamp = coerceDate(pick(fields, timeKeys));

  const consumed = new Set([...levelKeys, ...messageKeys, ...timeKeys]);
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!consumed.has(k)) extras[k] = v;
  }

  return { raw: line, lineNo, level, message, timestamp, fields: extras };
}

/** Fallback: keep the whole line as the message, sniff a level if present. */
export function parseRawLine(
  line: string,
  lineNo: number,
  config: RuntimeLogclawConfig,
): LogEntry {
  for (const pattern of config.compiledRawPatterns) {
    const match = pattern.regex.exec(line);
    if (!match?.groups) continue;

    const message = match.groups.message?.trim() ?? line;
    const timestamp = coerceDate(match.groups.timestamp);
    const matchedLevel = normalizeLevel(match.groups.level, config.levelAliasMap);
    const level = matchedLevel === "unknown" ? sniffLevel(message, config) : matchedLevel;
    const fields = Object.fromEntries(
      Object.entries(match.groups).filter(
        ([key, value]) =>
          value != null &&
          key !== "message" &&
          key !== "timestamp" &&
          key !== "level",
      ),
    );

    return {
      raw: line,
      lineNo,
      level,
      message,
      timestamp,
      fields,
    };
  }

  return {
    raw: line,
    lineNo,
    level: sniffLevel(line, config),
    message: line,
    fields: {},
  };
}

export function parserFor(
  format: LogFormat,
  config: RuntimeLogclawConfig,
): (line: string, lineNo: number) => LogEntry {
  switch (format) {
    case "json":
      return (line, lineNo) => parseJsonLine(line, lineNo, config);
    case "logfmt":
      return (line, lineNo) => parseLogfmtLine(line, lineNo, config);
    default:
      return (line, lineNo) => parseRawLine(line, lineNo, config);
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function asString(v: unknown): string | undefined {
  if (v == null) return undefined;
  return typeof v === "string" ? v : String(v);
}

/** Minimal logfmt: key=value, key="quoted value", bare tokens ignored. */
export function parseLogfmtPairs(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w[\w.\-]*)=(?:"((?:[^"\\]|\\.)*)"|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const key = m[1]!;
    const value = m[2] !== undefined ? m[2].replace(/\\"/g, '"') : (m[3] ?? "");
    out[key] = value;
  }
  return out;
}

function sniffLevel(line: string, config: RuntimeLogclawConfig) {
  const levelMatch = line.match(
    /\b(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|CRITICAL|PANIC)\b/i,
  );
  return normalizeLevel(levelMatch?.[1], config.levelAliasMap);
}

function utcDateFromParts(groups: Record<string, string>): Date {
  return new Date(
    Date.UTC(
      Number(groups.year),
      Number(groups.month) - 1,
      Number(groups.day),
      Number(groups.hour),
      Number(groups.minute),
      Number(groups.second),
      Number((groups.ms ?? "0").slice(0, 3).padEnd(3, "0")),
    ),
  );
}

function monthIndex(month: string): number | undefined {
  const index = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ].indexOf(month);
  return index >= 0 ? index : undefined;
}

function parseOffsetMinutes(offset: string): number {
  const sign = offset.startsWith("-") ? -1 : 1;
  const hours = Number(offset.slice(1, 3));
  const minutes = Number(offset.slice(3, 5));
  return sign * (hours * 60 + minutes);
}
