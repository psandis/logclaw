#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import chalk from "chalk";

import { detectFormat } from "./parser/detect.js";
import { parserFor } from "./parser/formats.js";
import { LogFormat, LogLevel } from "./parser/types.js";
import { groupMultiline } from "./transform/multiline.js";
import { collapseRepeats } from "./transform/collapse.js";
import { renderAll } from "./render/pretty.js";
import { summarize } from "./ai/summarize.js";

const VALID_FORMATS = new Set<LogFormat>([
  "json",
  "logfmt",
  "common",
  "syslog",
  "unknown",
]);

const program = new Command();

program
  .name("logclaw")
  .description(
    "A Node-native log investigator. Eats messy app output, groups stack " +
      "traces, collapses repeats, and (soon) summarizes what went wrong.",
  )
  .version("0.0.1")
  .argument("[file]", "log file to read; omit to read from stdin")
  .option("-l, --level <level>", "minimum level to show (trace|debug|info|warn|error|fatal)")
  .option("--format <format>", "force a format instead of auto-detect", "auto")
  .option("--no-color", "disable ANSI colors")
  .option("--no-group", "disable multiline / stack-trace grouping")
  .option("--no-collapse", "disable consecutive-repeat collapsing")
  .option("--no-trace", "hide grouped stack traces in output")
  .option("--summarize", "print an AI digest of what went wrong (stub)")
  .option("--errors-only", "with --summarize, only feed error/fatal entries")
  .action(run);

async function run(file: string | undefined, opts: OptionBag): Promise<void> {
  const source = file ? readFileSync(file, "utf8") : readStdin();
  const lines = source.split(/\r?\n/);

  // 1. Detect (or honor forced) format.
  const format = resolveFormat(opts.format, lines);
  const parseLine = parserFor(format);

  // 2. Group multiline events (stack traces) unless disabled.
  let entries = opts.group
    ? groupMultiline(lines, parseLine)
    : lines
        .filter((l) => l.trim().length > 0)
        .map((l, i) => parseLine(l, i + 1));

  // 3. Collapse consecutive repeats unless disabled.
  if (opts.collapse) entries = collapseRepeats(entries);

  // 4. Either summarize or render.
  if (opts.summarize) {
    const digest = await summarize(entries, { errorsOnly: opts.errorsOnly });
    process.stdout.write(digest + "\n");
    return;
  }

  const output = renderAll(entries, {
    color: opts.color,
    minLevel: opts.level as LogLevel | undefined,
    showTrace: opts.trace,
  });
  process.stdout.write(output + "\n");
}

function resolveFormat(requested: string, lines: string[]): LogFormat {
  if (requested && requested !== "auto") {
    if (!VALID_FORMATS.has(requested as LogFormat)) {
      process.stderr.write(
        chalk.yellow(`Unknown --format "${requested}", falling back to auto.\n`),
      );
    } else {
      return requested as LogFormat;
    }
  }
  const { format, confidence } = detectFormat(lines);
  if (process.env.LOGCLAW_DEBUG) {
    process.stderr.write(
      chalk.dim(`detected format=${format} confidence=${confidence.toFixed(2)}\n`),
    );
  }
  // TODO: when format === "unknown", offer to run the AI format-inference pass.
  return format;
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

interface OptionBag {
  level?: string;
  format: string;
  color: boolean;
  group: boolean;
  collapse: boolean;
  trace: boolean;
  summarize?: boolean;
  errorsOnly?: boolean;
}

program.parseAsync().catch((err: unknown) => {
  process.stderr.write(chalk.red(String(err)) + "\n");
  process.exit(1);
});
