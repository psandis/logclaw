import chalk, { type ChalkInstance } from "chalk";

import { RuntimeLogclawConfig } from "../config.js";
import { LogEntry, LogLevel, LEVEL_RANK } from "../parser/types.js";

// ---------------------------------------------------------------------------
// Pretty terminal rendering. Labels, the missing-timestamp placeholder, the
// repeat badge and every style come from config.render. Honors --no-color
// via the explicit `color` option.
// ---------------------------------------------------------------------------

export interface RenderOptions {
  color: boolean;
  config: RuntimeLogclawConfig;
  /** Minimum level to display (entries below are dropped). */
  minLevel?: LogLevel;
  /** Show the grouped stack trace under the headline. */
  showTrace: boolean;
}

type Formatter = (value: string) => string;

const identity: Formatter = (value) => value;

export function renderEntry(entry: LogEntry, opts: RenderOptions): string | null {
  if (
    opts.minLevel &&
    entry.level !== "unknown" &&
    LEVEL_RANK[entry.level] < LEVEL_RANK[opts.minLevel]
  ) {
    return null;
  }

  const render = opts.config.render;
  const style = (name: string): Formatter => (opts.color ? styleFormatter(name) : identity);

  const time = style(render.timestampStyle)(formatTime(entry, opts.config));
  const level = style(render.levelColors[entry.level])(render.levelLabels[entry.level]);

  let line = `${time} ${level}  ${entry.message}`;

  if (entry.repeatCount && entry.repeatCount > 1) {
    const badge = render.repeatBadge.replace("{count}", String(entry.repeatCount));
    line += " " + style(render.badgeStyle)(badge);
  }

  // "trace" holds the grouped stack trace (see multiline.ts); it is shown below the line.
  // Fields listed in render.hideFields are not shown.
  // With render.hideEmptyFields, null and empty-string values are not shown either.
  const hidden = opts.config.hiddenFields;
  const hideEmpty = render.hideEmptyFields;
  const fieldKeys = Object.keys(entry.fields).filter((k) => {
    if (k === "trace" || hidden.has(k)) return false;
    const value = entry.fields[k];
    return !(hideEmpty && (value === null || value === ""));
  });
  if (fieldKeys.length > 0) {
    const fieldStyle = style(render.fieldStyle);
    line += "  " + fieldKeys
      .map((k) => fieldStyle(`${k}=${stringifyValue(entry.fields[k])}`))
      .join(" ");
  }

  if (opts.showTrace && typeof entry.fields.trace === "string") {
    line += "\n" + style(render.traceStyle)(entry.fields.trace);
  }

  return line;
}

export function renderAll(entries: LogEntry[], opts: RenderOptions): string {
  const lines: string[] = [];
  for (const e of entries) {
    const rendered = renderEntry(e, opts);
    if (rendered !== null) lines.push(rendered);
  }
  return lines.join("\n");
}

/**
 * Format the entry time per render.timeZone:
 *   source: as written in the log (the source's UTC offset is kept)
 *   utc:    converted to UTC
 *   local:  converted to this machine's time zone
 * Timestamps written without an offset are always shown as written.
 */
function formatTime(entry: LogEntry, config: RuntimeLogclawConfig): string {
  const d = entry.timestamp;
  if (!d) return config.render.missingTimestamp;

  let shiftMinutes = 0;
  if (entry.timestampOffset !== undefined) {
    if (config.render.timeZone === "source") shiftMinutes = entry.timestampOffset;
    if (config.render.timeZone === "local") shiftMinutes = -d.getTimezoneOffset();
  }

  const [start, end] = config.render.timestampSlice;
  return new Date(d.getTime() + shiftMinutes * 60_000).toISOString().slice(start, end);
}

function stringifyValue(v: unknown): string {
  if (v == null) return "null";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const formatterCache = new Map<string, Formatter>();

/**
 * Turn a style string like "red", "dim.italic" or "bgRed.white" into a chalk
 * formatter. Each dot-separated part must be a chalk style; unknown parts are
 * ignored, so a typo leaves text unstyled instead of crashing.
 */
export function styleFormatter(style: string): Formatter {
  const cached = formatterCache.get(style);
  if (cached) return cached;

  let instance: ChalkInstance = chalk;
  let applied = false;
  for (const part of style.split(".")) {
    const next = (instance as unknown as Record<string, unknown>)[part.trim()];
    if (typeof next === "function") {
      instance = next as ChalkInstance;
      applied = true;
    }
  }

  const formatter: Formatter = applied ? (value) => instance(value) : identity;
  formatterCache.set(style, formatter);
  return formatter;
}
