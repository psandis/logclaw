import { RuntimeLogclawConfig } from "../config.js";
import { LogEntry, LogFormat, LogLevel, normalizeLevel } from "./types.js";

// ---------------------------------------------------------------------------
// Each parser takes a single source line + its line number and returns a
// normalized LogEntry. They assume the format has already been detected;
// detect.ts is responsible for choosing which one to run. Field names,
// timestamp formats, raw patterns and level words all come from config.
// ---------------------------------------------------------------------------

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (k in obj && obj[k] != null) return obj[k];
  }
  return undefined;
}

/** A parsed timestamp plus the UTC offset written in the source, if any. */
interface ParsedTime {
  date: Date;
  offset?: number;
}

/** Timestamp fields for a LogEntry. */
function timeFields(value: unknown, config: RuntimeLogclawConfig): Pick<LogEntry, "timestamp" | "timestampOffset"> {
  const parsed = coerceDate(value, config);
  if (!parsed) return { timestamp: undefined };
  return parsed.offset === undefined
    ? { timestamp: parsed.date }
    : { timestamp: parsed.date, timestampOffset: parsed.offset };
}

function coerceDate(value: unknown, config: RuntimeLogclawConfig): ParsedTime | undefined {
  if (value == null) return undefined;
  if (typeof value === "number") {
    // Seconds vs milliseconds, decided by config.parsers.epochMillisThreshold.
    const ms = value < config.parsers.epochMillisThreshold ? value * 1000 : value;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? undefined : { date: d };
  }
  if (typeof value === "string") {
    return parseTimestampString(value, config);
  }
  return undefined;
}

/**
 * Try each configured timestamp pattern in order. If none match, fall back to
 * the JavaScript Date parser (handles ISO 8601 strings with a zone).
 */
function parseTimestampString(value: string, config: RuntimeLogclawConfig): ParsedTime | undefined {
  for (const pattern of config.compiledTimestampPatterns) {
    const groups = pattern.regex.exec(value)?.groups;
    if (!groups) continue;
    const parsed = dateFromGroups(groups, config);
    if (parsed) return parsed;
  }

  const direct = new Date(value);
  if (!isNaN(direct.getTime())) {
    const zone = /(Z|[+-]\d{2}(?::?\d{2})?)$/i.exec(value.trim())?.[1];
    const offset = zone !== undefined ? parseOffsetMinutes(zone) : undefined;
    return offset === undefined ? { date: direct } : { date: direct, offset };
  }

  return undefined;
}

/** Build a date from named groups: year, month, day, hour, minute, second, fraction, offset. */
function dateFromGroups(
  groups: Record<string, string | undefined>,
  config: RuntimeLogclawConfig,
): ParsedTime | undefined {
  // Time-only timestamps (no month and day) use today's UTC date, like a missing year.
  const now = new Date();
  const timeOnly = groups.month === undefined && groups.day === undefined && groups.hour !== undefined;
  const month = timeOnly ? now.getUTCMonth() : parseMonth(groups.month, config);
  const day = timeOnly ? String(now.getUTCDate()) : groups.day;
  if (month === undefined || day === undefined) return undefined;

  const year = groups.year !== undefined ? Number(groups.year) : now.getUTCFullYear();
  const millis = Number((groups.fraction ?? "0").slice(0, 3).padEnd(3, "0"));
  const offset = groups.offset !== undefined ? parseOffsetMinutes(groups.offset) : undefined;
  if (groups.offset !== undefined && offset === undefined) return undefined;
  const offsetMinutes = offset ?? 0;

  const utc = Date.UTC(
    year,
    month,
    Number(day),
    Number(groups.hour ?? 0),
    Number(groups.minute ?? 0),
    Number(groups.second ?? 0),
    millis,
  );
  const date = new Date(utc - offsetMinutes * 60_000);
  if (isNaN(date.getTime())) return undefined;
  return offset === undefined ? { date } : { date, offset };
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
  const time = timeFields(pick(obj, timeKeys), config);

  // Everything not consumed above becomes an extra field.
  const consumed = new Set([...levelKeys, ...messageKeys, ...timeKeys]);
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!consumed.has(k)) fields[k] = v;
  }

  return { raw: line, lineNo, level, message, ...time, fields };
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
  const time = timeFields(pick(fields, timeKeys), config);

  const consumed = new Set([...levelKeys, ...messageKeys, ...timeKeys]);
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!consumed.has(k)) extras[k] = v;
  }

  return { raw: line, lineNo, level, message, ...time, fields: extras };
}

/** Fallback: try config.rawPatterns, else keep the whole line and sniff a level. */
export function parseRawLine(
  line: string,
  lineNo: number,
  config: RuntimeLogclawConfig,
): LogEntry {
  for (const pattern of config.compiledRawPatterns) {
    const match = pattern.regex.exec(line);
    if (!match?.groups) continue;

    const message = match.groups.message?.trim() ?? line;
    const time = timeFields(match.groups.timestamp, config);
    const rawLevel = match.groups.level?.trim();
    const matchedLevel =
      (rawLevel !== undefined ? pattern.levelMap?.get(rawLevel.toLowerCase()) : undefined) ??
      normalizeLevel(rawLevel, config.levelAliasMap);
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
      ...time,
      fields,
      pattern: pattern.name,
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

/** True when any rawPatterns entry (including the generic fallback entries) matches the line. */
export function isRawParsable(line: string, config: RuntimeLogclawConfig): boolean {
  return config.compiledRawPatterns.some((p) => p.regex.test(line));
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

/**
 * Minimal logfmt: key=value, key="quoted value", bare tokens ignored.
 * This regex is the logfmt syntax itself, not a tunable setting.
 */
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

function sniffLevel(line: string, config: RuntimeLogclawConfig): LogLevel {
  const match = config.levelSniffRegex.exec(line);
  return normalizeLevel(match?.groups?.level ?? match?.[1], config.levelAliasMap);
}

/** Month as a 0-based index: a number (1-12) or a name from config.timestamps.monthNames. */
function parseMonth(value: string | undefined, config: RuntimeLogclawConfig): number | undefined {
  if (value === undefined) return undefined;
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    return n >= 1 && n <= 12 ? n - 1 : undefined;
  }
  const lower = value.toLowerCase();
  const index = config.timestamps.monthNames.findIndex((m) => m.toLowerCase() === lower);
  return index >= 0 ? index : undefined;
}

/** Offset in minutes from "+HH", "+HHMM", "+HH:MM" or "Z". */
function parseOffsetMinutes(offset: string): number | undefined {
  if (offset === "Z" || offset === "z") return 0;
  const m = /^([+-])(\d{2})(?::?(\d{2}))?$/.exec(offset);
  if (!m) return undefined;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}
