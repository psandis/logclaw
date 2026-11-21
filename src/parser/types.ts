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

/** Canonical levels in rank order (unknown is separate). */
export type CanonicalLevel = Exclude<LogLevel, "unknown">;

export function isCanonicalLevel(value: string): value is CanonicalLevel {
  return value !== "unknown" && value in LEVEL_RANK;
}

/**
 * Formats logclaw can detect or be forced to.
 *   json, logfmt:   dedicated structured parsers
 *   common, syslog: recognized by config.detection.patterns, parsed by rawPatterns
 *   raw:            lines matched by config.rawPatterns
 *   unknown:        nothing matched; lines are shown as-is
 */
export const LOG_FORMATS = ["json", "logfmt", "common", "syslog", "raw", "unknown"] as const;

export type LogFormat = (typeof LOG_FORMATS)[number];

/** Formats detected by a regex from config.detection.patterns. */
export type PatternDetectedFormat = "common" | "syslog";

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
  /**
   * UTC offset in minutes written in the source timestamp (e.g. +0100 -> 60),
   * when it had one. Used to show the time as written (render.timeZone "source").
   */
  timestampOffset?: number;
  /** Any structured key/value pairs recovered from the line. */
  fields: Record<string, unknown>;
  /** How many times this entry repeated consecutively (set by collapse). */
  repeatCount?: number;
  /** Name of the rawPatterns entry that parsed this line, if any. */
  pattern?: string;
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
