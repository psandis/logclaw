import {
  compilePattern,
  CompiledRawPattern,
  RAW_PATTERN_DEFAULT_FLAGS,
  RuntimeLogclawConfig,
} from "../config.js";
import { complete, fillPrompt, resolveProvider } from "./provider.js";

// ---------------------------------------------------------------------------
// AI format inference (--ai-detect). Called when auto-detection returns
// "unknown". Sends a sample of lines to the configured provider and asks it to
// name a known raw pattern or supply a named-capture-group regex. Sample size,
// token limit and prompt come from config.ai.infer.
//
// Returns a CompiledRawPattern that is prepended to config.compiledRawPatterns
// for the current session, or null if inference fails or no provider is set.
// ---------------------------------------------------------------------------

export async function inferFormat(
  lines: string[],
  config: RuntimeLogclawConfig,
): Promise<CompiledRawPattern | null> {
  const provider = resolveProvider(config);
  if (!provider) return null;

  const settings = config.ai.infer;
  const sample = lines
    .filter((l) => l.trim().length > 0)
    .slice(0, settings.sampleSize);

  if (sample.length === 0) return null;

  const prompt = fillPrompt(settings.prompt, {
    knownFormats: config.compiledRawPatterns.map((p) => p.name).join(", "),
    lines: sample.join("\n"),
  });

  try {
    const response = await complete(provider, prompt, settings.maxTokens);
    return parseResponse(response.trim(), config);
  } catch {
    return null;
  }
}

function parseResponse(
  text: string,
  config: RuntimeLogclawConfig,
): CompiledRawPattern | null {
  if (!text || text === "unknown") return null;

  // Known format name: return the already-compiled pattern from config.
  const existing = config.compiledRawPatterns.find((p) => p.name === text);
  if (existing) return existing;

  // JSON object with a custom pattern.
  const jsonMatch = text.match(/\{.*\}/s);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { name?: string; pattern?: string };
      if (typeof parsed.pattern === "string") {
        const name = parsed.name ?? "ai-inferred";
        return {
          name,
          pattern: parsed.pattern,
          regex: compilePattern(parsed.pattern, RAW_PATTERN_DEFAULT_FLAGS, `ai-inferred "${name}"`),
        };
      }
    } catch {
      // fall through
    }
  }

  return null;
}
