import { describe, expect, it } from "vitest";

import { collapseRepeats } from "../src/transform/collapse.js";
import { LogEntry } from "../src/parser/types.js";

function entry(message: string, level: LogEntry["level"]): LogEntry {
  return {
    raw: message,
    lineNo: 1,
    level,
    message,
    fields: {},
  };
}

describe("collapseRepeats", () => {
  it("collapses consecutive identical level+message pairs", () => {
    const collapsed = collapseRepeats([
      entry("healthcheck ok", "info"),
      entry("healthcheck ok", "info"),
      entry("healthcheck ok", "info"),
      entry("slow query", "warn"),
    ]);

    expect(collapsed).toHaveLength(2);
    expect(collapsed[0]?.repeatCount).toBe(3);
    expect(collapsed[1]?.repeatCount).toBeUndefined();
  });

  it("does not collapse non-consecutive entries", () => {
    const collapsed = collapseRepeats([
      entry("healthcheck ok", "info"),
      entry("slow query", "warn"),
      entry("healthcheck ok", "info"),
    ]);

    expect(collapsed).toHaveLength(3);
  });
});
