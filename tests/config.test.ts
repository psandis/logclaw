import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadConfig,
  mergeConfig,
  resolveConfigFiles,
  stripJsonComments,
  userConfigPath,
} from "../src/config.js";
import { parseRawLine } from "../src/parser/formats.js";
import { renderEntry } from "../src/render/pretty.js";
import { groupMultiline } from "../src/transform/multiline.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "logclaw-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeConfig(name: string, content: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

describe("mergeConfig", () => {
  it("merges objects key by key", () => {
    const merged = mergeConfig(
      { render: { levelColors: { info: "green", warn: "yellow" } } },
      { render: { levelColors: { info: "cyan" } } },
    );
    expect(merged).toEqual({ render: { levelColors: { info: "cyan", warn: "yellow" } } });
  });

  it("puts user rawPatterns first and replaces defaults with the same name", () => {
    const merged = mergeConfig(
      { rawPatterns: [{ name: "a", pattern: "A" }, { name: "b", pattern: "B" }] },
      { rawPatterns: [{ name: "b", pattern: "B2" }, { name: "c", pattern: "C" }] },
    ) as { rawPatterns: Array<{ name: string; pattern: string }> };

    expect(merged.rawPatterns).toEqual([
      { name: "b", pattern: "B2" },
      { name: "c", pattern: "C" },
      { name: "a", pattern: "A" },
    ]);
  });

  it("applies the same name rule to timestamps.patterns", () => {
    const merged = mergeConfig(
      { timestamps: { patterns: [{ name: "x", pattern: "1" }] } },
      { timestamps: { patterns: [{ name: "y", pattern: "2" }] } },
    ) as { timestamps: { patterns: Array<{ name: string }> } };

    expect(merged.timestamps.patterns.map((p) => p.name)).toEqual(["y", "x"]);
  });

  it("adds user values to field mappings, level aliases and continuation patterns", () => {
    const merged = mergeConfig(
      {
        parsers: { fieldMappings: { level: ["level", "lvl"] } },
        levelAliases: { error: ["error"] },
        multiline: { continuationPatterns: ["^\\s+"] },
      },
      {
        parsers: { fieldMappings: { level: ["lvl", "sev"] } },
        levelAliases: { error: ["oops"] },
        multiline: { continuationPatterns: ["^>>"] },
      },
    );

    expect(merged).toEqual({
      parsers: { fieldMappings: { level: ["level", "lvl", "sev"] } },
      levelAliases: { error: ["error", "oops"] },
      multiline: { continuationPatterns: ["^\\s+", "^>>"] },
    });
  });

  it("replaces every other list", () => {
    const merged = mergeConfig(
      { render: { timestampSlice: [11, 23] }, ai: { summarize: { prompt: ["a", "b"] } } },
      { render: { timestampSlice: [0, 23] }, ai: { summarize: { prompt: ["c"] } } },
    );
    expect(merged).toEqual({
      render: { timestampSlice: [0, 23] },
      ai: { summarize: { prompt: ["c"] } },
    });
  });
});

describe("loadConfig", () => {
  it("loads only the bundled defaults when no files are given", () => {
    const config = loadConfig();
    expect(config.sources).toHaveLength(1);
    expect(config.sources[0]).toMatch(/defaults\.jsonc$/);
    expect(config.compiledRawPatterns.length).toBeGreaterThan(0);
  });

  it("uses a user raw pattern before the defaults", () => {
    const file = writeConfig("user.jsonc", {
      rawPatterns: [
        { name: "my-app", pattern: "^<(?<level>\\w+)> (?<message>.+)$" },
      ],
    });
    const config = loadConfig([file]);

    expect(config.compiledRawPatterns[0]?.name).toBe("my-app");
    expect(config.sources).toEqual([expect.stringMatching(/defaults\.jsonc$/), file]);

    const entry = parseRawLine("<ERROR> disk full", 1, config);
    expect(entry.level).toBe("error");
    expect(entry.message).toBe("disk full");
  });

  it("uses a user continuation pattern for multiline grouping", () => {
    const file = writeConfig("user.jsonc", {
      multiline: { continuationPatterns: ["^\\| "] },
    });
    const config = loadConfig([file]);

    const entries = groupMultiline(
      ["ERROR boom", "| detail one", "INFO ok"],
      (line, lineNo) => parseRawLine(line, lineNo, config),
      config.continuation,
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]?.fields.trace).toBe("| detail one");
  });

  it("uses user render settings", () => {
    const file = writeConfig("user.jsonc", {
      render: {
        missingTimestamp: "no-time",
        repeatBadge: "[{count}x]",
        levelLabels: { error: "ERR!!" },
      },
    });
    const config = loadConfig([file]);

    const line = renderEntry(
      { raw: "x", lineNo: 1, level: "error", message: "boom", fields: {}, repeatCount: 4 },
      { color: false, config, showTrace: false },
    );
    expect(line).toBe("no-time ERR!!  boom [4x]");
  });

  it("uses a user timestamp pattern", () => {
    const file = writeConfig("user.jsonc", {
      timestamps: {
        patterns: [
          {
            name: "dotted",
            pattern: "^(?<day>\\d{2})\\.(?<month>\\d{2})\\.(?<year>\\d{4}) (?<hour>\\d{2}):(?<minute>\\d{2}):(?<second>\\d{2})$",
          },
        ],
      },
      rawPatterns: [
        { name: "dotted-line", pattern: "^(?<timestamp>\\S+ \\S+) (?<message>.+)$" },
      ],
    });
    const config = loadConfig([file]);

    const entry = parseRawLine("21.05.2026 09:14:01 started", 1, config);
    expect(entry.timestamp?.toISOString()).toBe("2026-05-21T09:14:01.000Z");
  });

  it("merges files in order, later files winning", () => {
    const first = writeConfig("first.jsonc", { render: { missingTimestamp: "first" } });
    const second = writeConfig("second.jsonc", { render: { missingTimestamp: "second" } });
    expect(loadConfig([first, second]).render.missingTimestamp).toBe("second");
  });

  it("reports an invalid regex with its section and name", () => {
    const file = writeConfig("bad.jsonc", {
      rawPatterns: [{ name: "broken", pattern: "(unclosed" }],
    });
    expect(() => loadConfig([file])).toThrow(/Invalid regex in config \(rawPatterns "broken"\)/);
  });

  it("reports unreadable JSON with the file path", () => {
    const file = writeConfig("bad.jsonc", "{ not json");
    expect(() => loadConfig([file])).toThrow(`Cannot read config file ${file}`);
  });

  it("rejects a config file that is not an object", () => {
    const file = writeConfig("list.jsonc", "[]");
    expect(() => loadConfig([file])).toThrow("must contain a JSON object");
  });

  it("accepts line and block comments in user files", () => {
    const file = writeConfig(
      "comments.jsonc",
      `{
        // line comment
        /* block
           comment */
        "render": { "missingTimestamp": "http://not-a-comment" }
      }`,
    );
    expect(loadConfig([file]).render.missingTimestamp).toBe("http://not-a-comment");
  });
});

describe("stripJsonComments", () => {
  it("keeps comment-like text inside strings", () => {
    expect(stripJsonComments('{"a":"// x /* y */"} // z')).toBe('{"a":"// x /* y */"} ');
  });
});

describe("userConfigPath", () => {
  it("uses XDG_CONFIG_HOME on Linux and macOS when set", () => {
    expect(userConfigPath({ XDG_CONFIG_HOME: "/xdg" }, "linux", "/home/u")).toBe(
      join("/xdg", "logclaw", "config.jsonc"),
    );
  });

  it("falls back to ~/.config on Linux and macOS", () => {
    expect(userConfigPath({}, "darwin", "/Users/u")).toBe(
      join("/Users/u", ".config", "logclaw", "config.jsonc"),
    );
  });

  it("uses APPDATA on Windows", () => {
    expect(userConfigPath({ APPDATA: "C:\\AppData" }, "win32", "C:\\Users\\u")).toBe(
      join("C:\\AppData", "logclaw", "config.jsonc"),
    );
  });
});

describe("resolveConfigFiles", () => {
  it("returns nothing when there is no user file and no explicit path", () => {
    expect(resolveConfigFiles(undefined, { XDG_CONFIG_HOME: dir }, "linux")).toEqual([]);
  });

  it("finds the user file under XDG_CONFIG_HOME", () => {
    mkdirSync(join(dir, "logclaw"));
    const userFile = join(dir, "logclaw", "config.jsonc");
    writeFileSync(userFile, "{}");

    expect(resolveConfigFiles(undefined, { XDG_CONFIG_HOME: dir }, "linux")).toEqual([userFile]);
  });

  it("adds --config after the user file", () => {
    mkdirSync(join(dir, "logclaw"));
    const userFile = join(dir, "logclaw", "config.jsonc");
    writeFileSync(userFile, "{}");
    const explicit = writeConfig("extra.jsonc", "{}");

    expect(resolveConfigFiles(explicit, { XDG_CONFIG_HOME: dir }, "linux")).toEqual([
      userFile,
      explicit,
    ]);
  });

  it("reads LOGCLAW_CONFIG when --config is not given", () => {
    const explicit = writeConfig("env.jsonc", "{}");
    expect(
      resolveConfigFiles(undefined, { XDG_CONFIG_HOME: dir, LOGCLAW_CONFIG: explicit }, "linux"),
    ).toEqual([explicit]);
  });

  it("throws when the explicit config file does not exist", () => {
    const missing = join(dir, "missing.jsonc");
    expect(() => resolveConfigFiles(missing, { XDG_CONFIG_HOME: dir }, "linux")).toThrow(
      `Config file not found: ${missing}`,
    );
  });
});
