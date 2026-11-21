import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CanonicalLevel,
  isCanonicalLevel,
  LEVEL_RANK,
  LogLevel,
  PatternDetectedFormat,
} from "./parser/types.js";

// ---------------------------------------------------------------------------
// Configuration is layered: the bundled data/defaults.jsonc is loaded first,
// then the user config file, then an explicit --config / LOGCLAW_CONFIG file.
// Each layer is merged on top of the previous one (see mergeConfig for rules).
// All regexes are compiled once here, so a bad pattern fails at startup with
// a message naming the pattern.
// ---------------------------------------------------------------------------

export interface NamedPatternConfig {
  name: string;
  description?: string;
  example?: string;
  pattern: string;
  flags?: string;
  /**
   * rawPatterns only: level words that apply to this pattern alone, checked
   * (case-insensitively) before the global levelAliases. Example: {"E": "error"}.
   */
  levels?: Record<string, string>;
  /**
   * rawPatterns only: after a line matched by this pattern, following lines that
   * match this regex are folded into it (multi-line messages). Case-sensitive.
   */
  continuationPattern?: string;
  /**
   * rawPatterns only: a generic catch-all pattern. It parses lines, but does not
   * count when detection decides whether raw parsing beats JSON or logfmt.
   */
  fallback?: boolean;
}

/** How continuation lines are recognized (see transform/multiline.ts). */
export interface ContinuationRules {
  /** Global patterns from multiline.continuationPatterns. */
  patterns: readonly RegExp[];
  /** Per rawPatterns entry, by pattern name, from its continuationPattern. */
  byPattern: ReadonlyMap<string, RegExp>;
}

export type RawPatternConfig = NamedPatternConfig;

export type ProviderKind = "openai-responses" | "anthropic-messages";

export interface ProviderConfig {
  kind: ProviderKind;
  url: string;
  apiVersion?: string;
  apiKeyEnv: string[];
  modelEnv: string[];
  defaultModel: string;
}

export interface LogclawConfig {
  input: {
    skipPatterns: string[];
  };
  detection: {
    sampleSize: number;
    confidenceThreshold: number;
    logfmtMinPairs: number;
    patterns: Record<PatternDetectedFormat, string>;
  };
  parsers: {
    fieldMappings: {
      level: string[];
      message: string[];
      timestamp: string[];
    };
    epochMillisThreshold: number;
  };
  timestamps: {
    monthNames: string[];
    patterns: NamedPatternConfig[];
  };
  rawPatterns: RawPatternConfig[];
  levelSniff: {
    pattern: string;
    flags?: string;
  };
  levelAliases: Record<CanonicalLevel, string[]>;
  multiline: {
    continuationPatterns: string[];
  };
  render: {
    timestampSlice: [number, number];
    missingTimestamp: string;
    levelLabels: Record<LogLevel, string>;
    levelColors: Record<LogLevel, string>;
    repeatBadge: string;
    timeZone: "source" | "utc" | "local";
    hideFields: string[];
    hideEmptyFields: boolean;
    timestampStyle: string;
    badgeStyle: string;
    fieldStyle: string;
    traceStyle: string;
  };
  follow: {
    pollIntervalMs: number;
  };
  ai: {
    providers: Record<string, ProviderConfig>;
    summarize: {
      maxEntries: number;
      traceLines: number;
      maxTokens: number;
      prompt: string[];
    };
    infer: {
      sampleSize: number;
      maxTokens: number;
      prompt: string[];
    };
  };
}

export interface CompiledPattern extends NamedPatternConfig {
  regex: RegExp;
  /** Compiled `levels`, keyed by lowercase level word. */
  levelMap?: Map<string, CanonicalLevel>;
  /** Compiled `continuationPattern`. */
  continuationRegex?: RegExp;
}

export type CompiledRawPattern = CompiledPattern;

export interface RuntimeLogclawConfig extends LogclawConfig {
  compiledRawPatterns: CompiledPattern[];
  compiledTimestampPatterns: CompiledPattern[];
  continuation: ContinuationRules;
  compiledSkipPatterns: RegExp[];
  hiddenFields: ReadonlySet<string>;
  compiledDetectionPatterns: Record<PatternDetectedFormat, RegExp>;
  levelSniffRegex: RegExp;
  levelAliasMap: Map<string, CanonicalLevel>;
  /** Config files that were loaded, in merge order. */
  sources: string[];
}

const DEFAULT_CONFIG_URL = new URL("../data/defaults.jsonc", import.meta.url);

/** Default flags for rawPatterns entries (and AI-inferred patterns) that do not set "flags". */
export const RAW_PATTERN_DEFAULT_FLAGS = "i";

/**
 * Load the bundled defaults and merge each file in `files` on top, in order.
 * With no files this returns the bundled defaults only (used by tests).
 */
export function loadConfig(files: readonly string[] = []): RuntimeLogclawConfig {
  const defaultsPath = fileURLToPath(DEFAULT_CONFIG_URL);
  let merged = readConfigFile(defaultsPath);
  for (const file of files) {
    merged = mergeConfig(merged, readConfigFile(file)) as Record<string, unknown>;
  }

  const config = merged as unknown as LogclawConfig;

  const compiledRawPatterns = config.rawPatterns.map((p) =>
    compileNamedPattern(p, "rawPatterns", RAW_PATTERN_DEFAULT_FLAGS),
  );
  const compiledTimestampPatterns = config.timestamps.patterns.map((p) =>
    compileNamedPattern(p, "timestamps.patterns", ""),
  );

  return {
    ...config,
    compiledRawPatterns,
    compiledTimestampPatterns,
    continuation: {
      patterns: config.multiline.continuationPatterns.map((p, i) =>
        compilePattern(p, "", `multiline.continuationPatterns[${i}]`),
      ),
      byPattern: new Map(
        compiledRawPatterns
          .filter((p) => p.continuationRegex)
          .map((p) => [p.name, p.continuationRegex!] as const),
      ),
    },
    compiledSkipPatterns: config.input.skipPatterns.map((p, i) =>
      compilePattern(p, "", `input.skipPatterns[${i}]`),
    ),
    hiddenFields: new Set(config.render.hideFields),
    compiledDetectionPatterns: {
      common: compilePattern(config.detection.patterns.common, "", "detection.patterns.common"),
      syslog: compilePattern(config.detection.patterns.syslog, "", "detection.patterns.syslog"),
    },
    levelSniffRegex: compilePattern(
      config.levelSniff.pattern,
      config.levelSniff.flags ?? "",
      "levelSniff.pattern",
    ),
    levelAliasMap: buildLevelAliasMap(config.levelAliases),
    sources: [defaultsPath, ...files],
  };
}

/**
 * Config files to merge on top of the defaults: the user config file (if it
 * exists), then the explicit path from --config or LOGCLAW_CONFIG (which must exist).
 */
export function resolveConfigFiles(
  explicitPath?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const files: string[] = [];

  const userPath = userConfigPath(env, platform);
  if (existsSync(userPath)) files.push(userPath);

  const extra = explicitPath ?? env.LOGCLAW_CONFIG;
  if (extra) {
    const full = resolve(extra);
    if (!existsSync(full)) throw new Error(`Config file not found: ${full}`);
    if (full !== userPath) files.push(full);
  }

  return files;
}

/** Platform-specific location of the user config file. */
export function userConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (platform === "win32") {
    const base = env.APPDATA || join(home, "AppData", "Roaming");
    return join(base, "logclaw", "config.jsonc");
  }
  const base = env.XDG_CONFIG_HOME || join(home, ".config");
  return join(base, "logclaw", "config.jsonc");
}

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

/** Lists where user entries go first and replace defaults with the same name. */
const PREPEND_BY_NAME = ["rawPatterns", "timestamps.patterns"];

/** Lists where user values are added to the defaults. "*" matches any key. */
const APPEND_UNIQUE = [
  "input.skipPatterns",
  "parsers.fieldMappings.*",
  "levelAliases.*",
  "multiline.continuationPatterns",
  "render.hideFields",
];

/**
 * Merge `override` on top of `base`. Objects merge key by key. Lists follow
 * PREPEND_BY_NAME / APPEND_UNIQUE; any other list replaces the base list.
 */
export function mergeConfig(base: unknown, override: unknown, path: string[] = []): unknown {
  if (Array.isArray(base) && Array.isArray(override)) {
    if (PREPEND_BY_NAME.some((p) => pathMatches(p, path))) {
      return prependByName(base, override);
    }
    if (APPEND_UNIQUE.some((p) => pathMatches(p, path))) {
      return [...new Set([...base, ...override])];
    }
    return override;
  }

  if (isPlainObject(base) && isPlainObject(override)) {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
      out[key] = key in base ? mergeConfig(base[key], value, [...path, key]) : value;
    }
    return out;
  }

  return override;
}

function pathMatches(pattern: string, path: string[]): boolean {
  const parts = pattern.split(".");
  return parts.length === path.length && parts.every((p, i) => p === "*" || p === path[i]);
}

function prependByName(base: unknown[], override: unknown[]): unknown[] {
  const names = new Set(override.map(entryName).filter((n): n is string => n !== undefined));
  return [
    ...override,
    ...base.filter((b) => {
      const name = entryName(b);
      return name === undefined || !names.has(name);
    }),
  ];
}

function entryName(entry: unknown): string | undefined {
  return isPlainObject(entry) && typeof entry.name === "string" ? entry.name : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Compiling
// ---------------------------------------------------------------------------

/**
 * Compile a regex from config. The "g" and "y" flags are removed because the
 * patterns are reused across lines and those flags make matching stateful.
 */
export function compilePattern(source: string, flags: string, label: string): RegExp {
  try {
    return new RegExp(source, flags.replace(/[gy]/g, ""));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid regex in config (${label}): ${reason}`);
  }
}

function compileNamedPattern(
  pattern: NamedPatternConfig,
  section: string,
  defaultFlags: string,
): CompiledPattern {
  const label = `${section} "${pattern.name}"`;
  const compiled: CompiledPattern = {
    ...pattern,
    regex: compilePattern(pattern.pattern, pattern.flags ?? defaultFlags, label),
  };

  if (pattern.levels) {
    const levelMap = new Map<string, CanonicalLevel>();
    for (const [word, level] of Object.entries(pattern.levels)) {
      if (!isCanonicalLevel(level)) {
        throw new Error(
          `Invalid level in config (${label}): "${word}" maps to "${level}". ` +
            `Use one of: ${Object.keys(LEVEL_RANK).filter(isCanonicalLevel).join(", ")}.`,
        );
      }
      levelMap.set(word.toLowerCase(), level);
    }
    compiled.levelMap = levelMap;
  }

  if (pattern.continuationPattern !== undefined) {
    compiled.continuationRegex = compilePattern(
      pattern.continuationPattern,
      "",
      `${label} continuationPattern`,
    );
  }

  return compiled;
}

function buildLevelAliasMap(
  aliases: LogclawConfig["levelAliases"],
): Map<string, CanonicalLevel> {
  const map = new Map<string, CanonicalLevel>();

  for (const [level, values] of Object.entries(aliases)) {
    if (!isCanonicalLevel(level)) continue;
    for (const value of values) {
      map.set(value.toLowerCase(), level);
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Reading JSONC
// ---------------------------------------------------------------------------

function readConfigFile(path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(readFileSync(path, "utf8")));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read config file ${path}: ${reason}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Config file ${path} must contain a JSON object.`);
  }
  return parsed;
}

/** Remove // line comments and /* block comments *\/ outside of strings. */
export function stripJsonComments(input: string): string {
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

    if (char === "/" && next === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) {
        if (input[i] === "\n") out += "\n";
        i++;
      }
      i++; // skip the closing "/"
      continue;
    }

    out += char;
  }

  return out;
}
