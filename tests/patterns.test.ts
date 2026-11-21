import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { detectFormat } from "../src/parser/detect.js";
import { parseRawLine } from "../src/parser/formats.js";

// ---------------------------------------------------------------------------
// Data-driven checks for every pattern in data/defaults.jsonc. Adding a
// rawPatterns or timestamps.patterns entry with an "example" automatically adds
// a test for it here: no test code changes needed.
// ---------------------------------------------------------------------------

const config = loadConfig();

describe("rawPatterns examples", () => {
  const patterns = config.compiledRawPatterns;

  it("every pattern has an example", () => {
    const missing = patterns.filter((p) => !p.example).map((p) => p.name);
    expect(missing).toEqual([]);
  });

  for (const pattern of patterns.filter((p) => p.example)) {
    describe(pattern.name, () => {
      const example = pattern.example!;

      it("matches its own example", () => {
        expect(pattern.regex.test(example)).toBe(true);
      });

      it("is the first pattern to match its example (not shadowed by an earlier one)", () => {
        const first = patterns.find((p) => p.regex.test(example));
        expect(first?.name).toBe(pattern.name);
      });

      it("turns the captured timestamp and level into real values", () => {
        const groups = pattern.regex.exec(example)?.groups ?? {};
        const entry = parseRawLine(example, 1, config);
        expect(entry.message.length).toBeGreaterThan(0);
        if (groups.timestamp !== undefined) {
          expect(entry.timestamp, "timestamp did not parse").toBeInstanceOf(Date);
        }
        if (groups.level !== undefined) {
          expect(entry.level, "level is not mapped in levelAliases or levels").not.toBe("unknown");
        }
      });
    });
  }
});

describe("timestamps.patterns examples", () => {
  for (const pattern of config.compiledTimestampPatterns) {
    it(`${pattern.name} parses its example`, () => {
      expect(pattern.example, "add an example").toBeDefined();
      expect(pattern.regex.test(pattern.example!)).toBe(true);

      // Run the example through a raw pattern that captures it as the timestamp.
      const probe = loadConfigWith({
        rawPatterns: [{ name: "probe", pattern: "^(?<timestamp>.+) \\| (?<message>.+)$" }],
      });
      const entry = parseRawLine(`${pattern.example} | x`, 1, probe);
      expect(entry.timestamp).toBeInstanceOf(Date);
      expect(Number.isNaN(entry.timestamp!.getTime())).toBe(false);
    });
  }
});

describe("per-pattern levels", () => {
  it("maps pattern-specific level words without touching other patterns", () => {
    const custom = loadConfigWith({
      rawPatterns: [
        {
          name: "letters",
          pattern: "^(?<level>[A-Z][a-z]?) (?<message>.+)$",
          flags: "",
          levels: { E: "error", Df: "info", F: "fatal" },
        },
      ],
    });

    expect(parseRawLine("E disk full", 1, custom).level).toBe("error");
    expect(parseRawLine("Df started", 1, custom).level).toBe("info");
    expect(parseRawLine("F panic", 1, custom).level).toBe("fatal");
    // Global aliases are unchanged: "e" is not a level word elsewhere.
    expect(custom.levelAliasMap.has("e")).toBe(false);
  });

  it("rejects a level that is not a logclaw level", () => {
    expect(() =>
      loadConfigWith({
        rawPatterns: [{ name: "bad-levels", pattern: "^(?<message>.+)$", levels: { X: "severe" } }],
      }),
    ).toThrow(/Invalid level in config \(rawPatterns "bad-levels"\)/);
  });
});

describe("timezone offsets", () => {
  const probe = () =>
    loadConfigWith({
      timestamps: {
        patterns: [
          {
            name: "offset-probe",
            pattern:
              "^(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2}) (?<hour>\\d{2}):(?<minute>\\d{2}):(?<second>\\d{2})(?<offset>[+-]\\d{2}(?::?\\d{2})?)$",
          },
        ],
      },
      rawPatterns: [{ name: "probe", pattern: "^(?<timestamp>\\S+ \\S+) (?<message>.+)$" }],
    });

  it.each([
    ["2026-04-08 09:11:31+03", "2026-04-08T06:11:31.000Z"],
    ["2026-04-08 09:11:31+0300", "2026-04-08T06:11:31.000Z"],
    ["2026-04-08 09:11:31+03:00", "2026-04-08T06:11:31.000Z"],
    ["2026-04-08 09:11:31-0130", "2026-04-08T10:41:31.000Z"],
  ])("parses %s", (timestamp, expected) => {
    expect(parseRawLine(`${timestamp} msg`, 1, probe()).timestamp?.toISOString()).toBe(expected);
  });
});

describe("detection with raw patterns", () => {
  it("prefers rawPatterns over logfmt when a custom format contains key=value pairs", () => {
    const custom = loadConfigWith({
      rawPatterns: [
        { name: "kv-app", pattern: "^\\[(?<level>\\w+)\\] (?<message>.+)$" },
      ],
    });
    const lines = [
      "[error] request failed status=500 path=/a",
      "[info] request ok status=200 path=/b",
    ];

    expect(detectFormat(lines, custom).format).toBe("raw");
    expect(parseRawLine(lines[0]!, 1, custom).level).toBe("error");
  });

  it("still detects plain logfmt", () => {
    const lines = ["level=info msg=ok a=1", "level=warn msg=slow a=2"];
    expect(detectFormat(lines, config).format).toBe("logfmt");
  });

  it("reports unknown when no pattern matches", () => {
    expect(detectFormat(["zzz", "qqq"], config).format).toBe("unknown");
  });
});

function loadConfigWith(override: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "logclaw-patterns-"));
  try {
    const file = join(dir, "config.jsonc");
    writeFileSync(file, JSON.stringify(override));
    return loadConfig([file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
