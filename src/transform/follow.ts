import { openSync, readSync, closeSync, watchFile, unwatchFile } from "node:fs";
import { ContinuationRules } from "../config.js";
import { LogEntry } from "../parser/types.js";
import { appendContinuation, isContinuation } from "./multiline.js";

// ---------------------------------------------------------------------------
// Stateful incremental processing for --follow mode. Each watch callback
// produces a batch of complete lines; we carry multiline grouping state and
// collapse state across batches so the output is consistent with batch mode.
//
// Note: if a multi-line event is split across two OS write calls, the
// continuation lines will be treated as a new entry. In practice loggers write
// full events atomically, so this is rarely a problem.
// ---------------------------------------------------------------------------

export interface FollowContext {
  offset: number;
  lineBuffer: string;
  openEntry: LogEntry | null;
  lastEntry: LogEntry | null;
  lineNo: number;
}

export interface FollowOptions {
  /** Poll interval in milliseconds (config.follow.pollIntervalMs). */
  intervalMs: number;
  /** Continuation rules (config.continuation). */
  continuation: ContinuationRules;
  /** Lines to drop, such as headers (config.compiledSkipPatterns). */
  skip: readonly RegExp[];
  startOffset?: number;
  startLineNo?: number;
}

export function createFollowContext(startOffset = 0, startLineNo = 1): FollowContext {
  return {
    offset: startOffset,
    lineBuffer: "",
    openEntry: null,
    lastEntry: null,
    lineNo: startLineNo,
  };
}

export function followFile(
  path: string,
  parseLine: (line: string, lineNo: number) => LogEntry,
  onEntries: (entries: LogEntry[]) => void,
  options: FollowOptions,
): () => void {
  const ctx = createFollowContext(options.startOffset ?? 0, options.startLineNo ?? 1);

  function tick(): void {
    const lines = readNewLines(path, ctx).filter(
      (line) => !options.skip.some((re) => re.test(line)),
    );
    if (lines.length === 0) return;
    const entries = processLines(lines, ctx, parseLine, options.continuation);
    if (entries.length > 0) onEntries(entries);
  }

  // Process any content already in the file (or skip if startOffset is at EOF).
  tick();

  watchFile(path, { interval: options.intervalMs }, tick);

  return () => {
    unwatchFile(path);
  };
}

export function readNewLines(path: string, ctx: FollowContext): string[] {
  const fd = openSync(path, "r");
  const chunks: Buffer[] = [];
  const buf = Buffer.alloc(65536);
  let bytesRead: number;

  while ((bytesRead = readSync(fd, buf, 0, buf.length, ctx.offset)) > 0) {
    ctx.offset += bytesRead;
    chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
  }
  closeSync(fd);

  if (chunks.length === 0) return [];

  ctx.lineBuffer += Buffer.concat(chunks).toString("utf8");

  const lastNewline = ctx.lineBuffer.lastIndexOf("\n");
  if (lastNewline === -1) return [];

  const complete = ctx.lineBuffer.slice(0, lastNewline);
  ctx.lineBuffer = ctx.lineBuffer.slice(lastNewline + 1);

  return complete.split("\n").filter((l) => l.trim().length > 0);
}

export function processLines(
  lines: string[],
  ctx: FollowContext,
  parseLine: (line: string, lineNo: number) => LogEntry,
  continuation: ContinuationRules,
): LogEntry[] {
  const out: LogEntry[] = [];

  for (const line of lines) {
    if (ctx.openEntry && isContinuation(line, continuation, ctx.openEntry)) {
      appendContinuation(ctx.openEntry, line);
      continue;
    }

    if (ctx.openEntry) {
      out.push(...collapseEntry(ctx.openEntry, ctx));
      ctx.openEntry = null;
    }

    ctx.openEntry = parseLine(line, ctx.lineNo++);
  }

  // Flush at end of batch: loggers typically write complete events atomically.
  if (ctx.openEntry) {
    out.push(...collapseEntry(ctx.openEntry, ctx));
    ctx.openEntry = null;
  }

  return out;
}

function collapseEntry(entry: LogEntry, ctx: FollowContext): LogEntry[] {
  if (
    ctx.lastEntry &&
    ctx.lastEntry.level === entry.level &&
    ctx.lastEntry.message === entry.message
  ) {
    ctx.lastEntry = {
      ...ctx.lastEntry,
      repeatCount: (ctx.lastEntry.repeatCount ?? 1) + 1,
    };
    return [{ ...ctx.lastEntry }];
  }
  ctx.lastEntry = { ...entry };
  return [entry];
}
