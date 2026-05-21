import { LogEntry } from "../parser/types.js";

// ---------------------------------------------------------------------------
// Multiline grouping. A Node/Java/Python stack trace is conceptually ONE event
// spread across many lines. Naive log tools shred them. We detect continuation
// lines (indented, "at ...", "Caused by:", "...", bare exception frames) and
// fold them into the preceding entry's raw + message.
//
// Heuristic, not perfect — but this is exactly the case hl (JSON/logfmt only)
// does not handle, so it's worth getting reasonably right.
// ---------------------------------------------------------------------------

const CONTINUATION_RE = [
  /^\s+/, // leading whitespace (indented frame)
  /^\s*at\s+/, // Java/Node: "at Object.<anonymous> (...)"
  /^\s*Caused by:/, // Java chained exceptions
  /^\s*\.\.\.\s+\d+\s+more/, // Java "... 12 more"
  /^\s*File ".*", line \d+/, // Python traceback frame
  /^\s*Traceback \(most recent call last\)/, // Python header
  /^[A-Za-z.]+(?:Error|Exception):/, // bare exception type line
];

function isContinuation(line: string): boolean {
  if (line.trim().length === 0) return false;
  return CONTINUATION_RE.some((re) => re.test(line));
}

/**
 * Given the raw source lines and the per-line parser, produce grouped entries.
 * Continuation lines are appended to the previous entry rather than becoming
 * their own.
 */
export function groupMultiline(
  lines: string[],
  parseLine: (line: string, lineNo: number) => LogEntry,
): LogEntry[] {
  const entries: LogEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().length === 0) continue;

    const prev = entries[entries.length - 1];
    if (prev && isContinuation(line)) {
      prev.raw += "\n" + line;
      // Keep the headline message short; stash the trace as a field.
      const existing = (prev.fields.trace as string | undefined) ?? "";
      prev.fields.trace = existing ? existing + "\n" + line : line;
      continue;
    }

    entries.push(parseLine(line, i + 1));
  }

  return entries;
}
