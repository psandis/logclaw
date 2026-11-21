import { ContinuationRules } from "../config.js";
import { LogEntry } from "../parser/types.js";

// ---------------------------------------------------------------------------
// Multiline grouping. A Node/Java/Python stack trace, or a multi-line message
// in a timestamped log, is ONE event spread across many lines. A line is a
// continuation when it matches a global pattern (multiline.continuationPatterns)
// or the continuationPattern of the rawPatterns entry that parsed the previous
// entry. Continuation lines are folded into that entry's raw text and its
// "trace" field.
// ---------------------------------------------------------------------------

export function isContinuation(
  line: string,
  rules: ContinuationRules,
  previous?: LogEntry,
): boolean {
  if (line.trim().length === 0) return false;
  if (rules.patterns.some((re) => re.test(line))) return true;
  const own = previous?.pattern !== undefined ? rules.byPattern.get(previous.pattern) : undefined;
  return own !== undefined && own.test(line);
}

/** Append a continuation line to an entry. */
export function appendContinuation(entry: LogEntry, line: string): void {
  entry.raw += "\n" + line;
  // Keep the headline message short; stash the extra lines as a field.
  const existing = (entry.fields.trace as string | undefined) ?? "";
  entry.fields.trace = existing ? existing + "\n" + line : line;
}

/**
 * Given the raw source lines and the per-line parser, produce grouped entries.
 * Continuation lines are appended to the previous entry rather than becoming
 * their own.
 */
export function groupMultiline(
  lines: string[],
  parseLine: (line: string, lineNo: number) => LogEntry,
  rules: ContinuationRules,
): LogEntry[] {
  const entries: LogEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().length === 0) continue;

    const prev = entries[entries.length - 1];
    if (prev && isContinuation(line, rules, prev)) {
      appendContinuation(prev, line);
      continue;
    }

    entries.push(parseLine(line, i + 1));
  }

  return entries;
}
