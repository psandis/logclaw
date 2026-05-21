// Core data model shared across the parse → transform → render pipeline.

export type LogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal"
  | "unknown";

export const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
  unknown: -1,
};

export type LogFormat = "json" | "logfmt" | "common" | "syslog" | "unknown";

/**
 * A single normalized log event. One entry may span multiple source lines
 * once multiline grouping has folded a stack trace into its parent.
 */
export interface LogEntry {
  /** The original source text (possibly multiple lines after grouping). */
  raw: string;
  /** 1-based line number where the entry began in the source. */
  lineNo: number;
  level: LogLevel;
  message: string;
  timestamp?: Date;
  /** Any structured key/value pairs recovered from the line. */
  fields: Record<string, unknown>;
  /** How many times this entry repeated consecutively (set by collapse). */
  repeatCount?: number;
}

/** Normalize an arbitrary level-ish string into a known LogLevel. */
export function normalizeLevel(
  input: string | undefined,
  aliases?: ReadonlyMap<string, Exclude<LogLevel, "unknown">>,
): LogLevel {
  if (!input) return "unknown";
  const s = input.trim().toLowerCase();
  return aliases?.get(s) ?? "unknown";
}
