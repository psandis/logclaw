import { LogEntry } from "../parser/types.js";

// ---------------------------------------------------------------------------
// Collapse consecutive identical entries into a single entry carrying a
// repeatCount. Cheap to implement, instantly makes noisy logs (healthcheck
// pings, retry loops) readable. The renderer is responsible for showing the
// "(xN)" badge.
// ---------------------------------------------------------------------------

/** Two entries are "the same" if their message + level match. */
function sameEvent(a: LogEntry, b: LogEntry): boolean {
  return a.level === b.level && a.message === b.message;
}

export function collapseRepeats(entries: LogEntry[]): LogEntry[] {
  const out: LogEntry[] = [];

  for (const entry of entries) {
    const last = out[out.length - 1];
    if (last && sameEvent(last, entry)) {
      last.repeatCount = (last.repeatCount ?? 1) + 1;
      continue;
    }
    out.push({ ...entry });
  }

  return out;
}
