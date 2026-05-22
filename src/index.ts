#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import chalk from "chalk";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

import { loadConfig } from "./config.js";
import { loadEnv } from "./env.js";
import { readSource, readFile } from "./io/source.js";
import { detectFormat } from "./parser/detect.js";
import { parserFor } from "./parser/formats.js";
import { LogFormat, LogLevel } from "./parser/types.js";
import { groupMultiline } from "./transform/multiline.js";
import { collapseRepeats } from "./transform/collapse.js";
import { followFile } from "./transform/follow.js";
import { renderAll, renderEntry } from "./render/pretty.js";
import { summarize } from "./ai/summarize.js";
import { inferFormat } from "./ai/infer.js";

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
      "traces, collapses repeats, and summarizes what went wrong.",
  )
  .version(version)
  .argument("[file]", "log file to read; omit to read from stdin")
  .option("-l, --level <level>", "minimum level to show (trace|debug|info|warn|error|fatal)")
  .option("--format <format>", "force a format instead of auto-detect", "auto")
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
  const config = loadConfig();

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
    const initialLines = initialSource.split(/\r?\n/);
    const format = resolveFormat(opts.format, initialLines, config);
    const parseLine = parserFor(format, config);

    const renderOpts = {
      color: opts.color,
      config,
      minLevel: opts.level as LogLevel | undefined,
      showTrace: opts.trace,
    };

    // Render existing content using the batch pipeline.
    let initialEntries = groupMultiline(initialLines, parseLine);
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
      { startOffset, startLineNo },
    );

    process.on("SIGINT", () => { stop(); process.exit(0); });
    process.on("SIGTERM", () => { stop(); process.exit(0); });

    // Block until signal.
    await new Promise<never>(() => {});
    return;
  }

  const source = readSource(file);
  const lines = source.split(/\r?\n/);

  let format = resolveFormat(opts.format, lines, config);

  if (format === "unknown" && opts.aiDetect) {
    const inferred = await inferFormat(lines, config);
    if (inferred) {
      if (process.env.LOGCLAW_DEBUG) {
        process.stderr.write(chalk.dim(`ai-inferred pattern=${inferred.name}\n`));
      }
      config.compiledRawPatterns.unshift(inferred);
    }
  }

  const parseLine = parserFor(format, config);

  let entries = opts.group
    ? groupMultiline(lines, parseLine)
    : lines
        .filter((l) => l.trim().length > 0)
        .map((l, i) => parseLine(l, i + 1));

  if (opts.collapse) entries = collapseRepeats(entries);

  if (opts.summarize) {
    const digest = await summarize(entries, { errorsOnly: opts.errorsOnly });
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

function resolveFormat(
  requested: string,
  lines: string[],
  config: ReturnType<typeof loadConfig>,
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
