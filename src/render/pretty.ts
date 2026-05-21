import { RuntimeLogclawConfig } from "../config.js";
import chalk from "chalk";
import { LogEntry, LogLevel, LEVEL_RANK } from "../parser/types.js";

// ---------------------------------------------------------------------------
// Pretty terminal rendering. Level-aware colors, a dim timestamp, a repeat
// badge, and a folded/dimmed stack trace. Honors --no-color via chalk's own
// level detection plus the explicit `color` option.
// ---------------------------------------------------------------------------

export interface RenderOptions {
  color: boolean;
  config: RuntimeLogclawConfig;
  /** Minimum level to display (entries below are dropped). */
  minLevel?: LogLevel;
  /** Show the grouped stack trace under the headline. */
  showTrace: boolean;
}

const LEVEL_LABEL: Record<LogLevel, string> = {
  trace: "TRACE",
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
  fatal: "FATAL",
  unknown: "·····",
};

function colorizeLevel(level: LogLevel, on: boolean, config: RuntimeLogclawConfig): string {
  const label = LEVEL_LABEL[level];
  if (!on) return label;
  const style = config.render.levelColors[level] ?? "dim";
  const formatter = colorFormatter(style);
  return formatter(label);
}

function formatTime(d: Date | undefined, on: boolean, config: RuntimeLogclawConfig): string {
  if (!d) return on ? chalk.dim("--:--:--") : "--:--:--";
  const [start, end] = config.render.timestampSlice;
  const t = d.toISOString().slice(start, end);
  return on ? chalk.dim(t) : t;
}

export function renderEntry(entry: LogEntry, opts: RenderOptions): string | null {
  if (
    opts.minLevel &&
    entry.level !== "unknown" &&
    LEVEL_RANK[entry.level] < LEVEL_RANK[opts.minLevel]
  ) {
    return null;
  }

  const on = opts.color;
  const time = formatTime(entry.timestamp, on, opts.config);
  const level = colorizeLevel(entry.level, on, opts.config);

  let line = `${time} ${level}  ${entry.message}`;

  if (entry.repeatCount && entry.repeatCount > 1) {
    const badge = `(×${entry.repeatCount})`;
    line += " " + (on ? chalk.dim.italic(badge) : badge);
  }

  const fieldKeys = Object.keys(entry.fields).filter((k) => k !== "trace");
  if (fieldKeys.length > 0) {
    const rendered = fieldKeys
      .map((k) => {
        const kv = `${k}=${stringifyValue(entry.fields[k])}`;
        return on ? chalk.cyan(kv) : kv;
      })
      .join(" ");
    line += "  " + rendered;
  }

  if (opts.showTrace && typeof entry.fields.trace === "string") {
    const trace = entry.fields.trace as string;
    line += "\n" + (on ? chalk.dim(trace) : trace);
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

function stringifyValue(v: unknown): string {
  if (v == null) return "null";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function colorFormatter(style: string): (value: string) => string {
  switch (style) {
    case "gray":
      return chalk.gray;
    case "blue":
      return chalk.blue;
    case "green":
      return chalk.green;
    case "yellow":
      return chalk.yellow;
    case "red":
      return chalk.red;
    case "bgRed":
      return chalk.bgRed.white;
    case "white":
      return chalk.white;
    case "cyan":
      return chalk.cyan;
    case "magenta":
      return chalk.magenta;
    default:
      return chalk.dim;
  }
}
