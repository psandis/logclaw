#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import chalk from "chalk";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

import { loadConfig, resolveConfigFiles, RuntimeLogclawConfig } from "./config.js";
import { loadEnv } from "./env.js";
import { readSource, readFile } from "./io/source.js";
import { detectFormat, headLines } from "./parser/detect.js";
import { isRawParsable, parserFor } from "./parser/formats.js";
import { LOG_FORMATS, LogFormat, LogLevel } from "./parser/types.js";
import { groupMultiline } from "./transform/multiline.js";
import { collapseRepeats } from "./transform/collapse.js";
import { followFile } from "./transform/follow.js";
import { renderAll, renderEntry } from "./render/pretty.js";
import { summarize } from "./ai/summarize.js";
import { inferFormat } from "./ai/infer.js";

const VALID_FORMATS = new Set<string>(LOG_FORMATS);

const program = new Command();

program
  .name("logclaw")
  .description(
    "A Node-native log investigator. Eats messy app output, groups stack " +
      "traces, collapses repeats, and summarizes what went wrong.",
  )
  .version(version)
  .argument("[file]", "log file to read; omit to read from stdin")
  .option("-l, --level <level>", "minimum level to show (trace|debug|info|warn|error|fatal)")
  .option("--format <format>", `force a format instead of auto-detect (${LOG_FORMATS.join("|")})`, "auto")
  .option("--config <path>", "extra config file merged on top of the defaults and user config")
  .option("-f, --follow", "watch the file for new lines and render them as they arrive")
  .option("--no-color", "disable ANSI colors")
  .option("--no-group", "disable multiline / stack-trace grouping")
  .option("--no-collapse", "disable consecutive-repeat collapsing")
  .option("--no-trace", "hide grouped stack traces in output")
  .option("--summarize", "print an AI digest of what went wrong")
  .option("--errors-only", "with --summarize, only feed error/fatal entries")
  .option("--ai-detect", "use AI to infer format when auto-detection returns unknown (requires provider key)")
  .action(run);

async function run(file: string | undefined, opts: OptionBag): Promise<void> {
  loadEnv();
  const config = loadConfig(resolveConfigFiles(opts.config));
  if (process.env.LOGCLAW_DEBUG) {
    process.stderr.write(chalk.dim(`config files: ${config.sources.join(", ")}\n`));
  }
  const continuation = config.continuation;

  if (opts.follow) {
    if (!file) {
      process.stderr.write(chalk.red("--follow requires a file path; stdin is not supported.\n"));
      process.exit(1);
    }
    if (!process.stdout.isTTY) {
      process.stderr.write(chalk.yellow("warning: --follow is most useful in an interactive terminal.\n"));
    }

    // Detect format from current file content, render it, then tail from EOF.
    const initialSource = readFile(file);
    const initialLines = blankSkippedLines(initialSource.split(/\r?\n/), config);
    const format = resolveFormat(opts.format, initialLines, config);
    warnIfUnknown(format, initialLines, config);
    const parseLine = parserFor(format, config);

    const renderOpts = {
      color: opts.color,
      config,
      minLevel: opts.level as LogLevel | undefined,
      showTrace: opts.trace,
    };

    // Render existing content using the batch pipeline.
    let initialEntries = groupMultiline(initialLines, parseLine, continuation);
    initialEntries = collapseRepeats(initialEntries);
    const initialOutput = renderAll(initialEntries, renderOpts);
    if (initialOutput) process.stdout.write(initialOutput + "\n");

    // Start tailing from end of current content.
    const startOffset = Buffer.byteLength(initialSource, "utf8");
    const startLineNo = initialLines.length + 1;

    const stop = followFile(
      file,
      parseLine,
      (entries) => {
        for (const entry of entries) {
          const line = renderEntry(entry, renderOpts);
          if (line !== null) process.stdout.write(line + "\n");
        }
      },
      {
        intervalMs: config.follow.pollIntervalMs,
        continuation,
        skip: config.compiledSkipPatterns,
        startOffset,
        startLineNo,
      },
    );

    process.on("SIGINT", () => { stop(); process.exit(0); });
    process.on("SIGTERM", () => { stop(); process.exit(0); });

    // Block until signal.
    await new Promise<never>(() => {});
    return;
  }

  // No file and nothing piped in: stdin is the terminal, so there is no input.
  if (!file && process.stdin.isTTY) {
    process.stderr.write(
      chalk.red("error: no input. Pass a log file, or pipe logs in (cat app.log | logclaw).\n\n"),
    );
    program.outputHelp({ error: true });
    process.exit(1);
  }

  const source = await readSource(file);
  const lines = blankSkippedLines(source.split(/\r?\n/), config);

  if (lines.every((line) => line.trim().length === 0)) {
    process.stderr.write(chalk.yellow(`warning: ${file ?? "stdin"} has no log lines.\n`));
    return;
  }

  let format = resolveFormat(opts.format, lines, config);

  if (format === "unknown" && opts.aiDetect) {
    const inferred = await inferFormat(lines, config);
    if (inferred) {
      if (process.env.LOGCLAW_DEBUG) {
        process.stderr.write(chalk.dim(`ai-inferred pattern=${inferred.name}\n`));
      }
      config.compiledRawPatterns.unshift(inferred);
      format = "raw";
    }
  }

  warnIfUnknown(format, lines, config);

  const parseLine = parserFor(format, config);

  // Line numbers are 1-based positions in the source, including blank lines.
  let entries = opts.group
    ? groupMultiline(lines, parseLine, continuation)
    : lines.flatMap((l, i) => (l.trim().length > 0 ? [parseLine(l, i + 1)] : []));

  if (opts.collapse) entries = collapseRepeats(entries);

  if (opts.summarize) {
    const digest = await summarize(entries, config, { errorsOnly: opts.errorsOnly });
    process.stdout.write(digest + "\n");
    return;
  }

  const output = renderAll(entries, {
    color: opts.color,
    config,
    minLevel: opts.level as LogLevel | undefined,
    showTrace: opts.trace,
  });
  process.stdout.write(output + "\n");
}

/**
 * Replace lines matching config.input.skipPatterns (such as column headers) with
 * empty strings. Blank lines are ignored everywhere, and line numbers stay correct.
 */
function blankSkippedLines(lines: string[], config: RuntimeLogclawConfig): string[] {
  const skip = config.compiledSkipPatterns;
  if (skip.length === 0) return lines;
  return lines.map((line) => (skip.some((re) => re.test(line)) ? "" : line));
}

/** Tell the user when no format matched, instead of silently showing raw lines. */
function warnIfUnknown(format: LogFormat, lines: string[], config: RuntimeLogclawConfig): void {
  if (format !== "unknown") return;
  const sample = headLines(lines, config);
  const matched = sample.filter((l) => isRawParsable(l, config)).length;
  process.stderr.write(
    chalk.yellow(
      `warning: no log format matched most lines (${matched} of ${sample.length} sampled entries ` +
        "matched a rawPatterns entry). Unmatched lines are shown as-is.\n" +
        "         Add a rawPatterns entry to your config (see README, Configuration) or try --ai-detect.\n",
    ),
  );
}

function resolveFormat(
  requested: string,
  lines: string[],
  config: RuntimeLogclawConfig,
): LogFormat {
  if (requested && requested !== "auto") {
    if (!VALID_FORMATS.has(requested as LogFormat)) {
      process.stderr.write(
        chalk.yellow(`Unknown --format "${requested}", falling back to auto.\n`),
      );
    } else {
      return requested as LogFormat;
    }
  }
  const { format, confidence } = detectFormat(lines, config);
  if (process.env.LOGCLAW_DEBUG) {
    process.stderr.write(
      chalk.dim(`detected format=${format} confidence=${confidence.toFixed(2)}\n`),
    );
  }
  return format;
}

interface OptionBag {
  level?: string;
  format: string;
  config?: string;
  follow?: boolean;
  color: boolean;
  group: boolean;
  collapse: boolean;
  trace: boolean;
  summarize?: boolean;
  errorsOnly?: boolean;
  aiDetect?: boolean;
}

program.parseAsync().catch((err: unknown) => {
  process.stderr.write(chalk.red(String(err)) + "\n");
  process.exit(1);
});
