import { readFileSync } from "node:fs";

import { LogLevel } from "./parser/types.js";

export interface RawPatternConfig {
  name: string;
  description?: string;
  example?: string;
  pattern: string;
}

export interface LogclawConfig {
  detection: {
    sampleSize: number;
    confidenceThreshold: number;
  };
  parsers: {
    fieldMappings: {
      level: string[];
      message: string[];
      timestamp: string[];
    };
  };
  rawPatterns: RawPatternConfig[];
  levelAliases: Record<Exclude<LogLevel, "unknown">, string[]>;
  render: {
    timestampSlice: [number, number];
    levelColors: Record<LogLevel, string>;
  };
}

export interface CompiledRawPattern extends RawPatternConfig {
  regex: RegExp;
}

export interface RuntimeLogclawConfig extends LogclawConfig {
  compiledRawPatterns: CompiledRawPattern[];
  levelAliasMap: Map<string, Exclude<LogLevel, "unknown">>;
}

const DEFAULT_CONFIG_URL = new URL("../data/defaults.jsonc", import.meta.url);

export function loadConfig(): RuntimeLogclawConfig {
  const raw = readFileSync(DEFAULT_CONFIG_URL, "utf8");
  const parsed = JSON.parse(stripJsonComments(raw)) as LogclawConfig;

  return {
    ...parsed,
    compiledRawPatterns: parsed.rawPatterns.map((pattern) => ({
      ...pattern,
      regex: new RegExp(pattern.pattern, "i"),
    })),
    levelAliasMap: buildLevelAliasMap(parsed.levelAliases),
  };
}

function buildLevelAliasMap(
  aliases: LogclawConfig["levelAliases"],
): Map<string, Exclude<LogLevel, "unknown">> {
  const map = new Map<string, Exclude<LogLevel, "unknown">>();

  for (const [level, values] of Object.entries(aliases)) {
    for (const value of values) {
      map.set(value.toLowerCase(), level as Exclude<LogLevel, "unknown">);
    }
  }

  return map;
}

function stripJsonComments(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    const next = input[i + 1];

    if (inString) {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      if (i < input.length) out += "\n";
      continue;
    }

    out += char;
  }

  return out;
}
