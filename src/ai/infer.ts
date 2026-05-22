import { RuntimeLogclawConfig, CompiledRawPattern } from "../config.js";

// ---------------------------------------------------------------------------
// AI format inference. Called when auto-detection returns "unknown" and the
// --ai-detect flag is set. Sends a sample of lines to the configured provider
// and asks it to identify the format or supply a named-capture-group regex.
//
// Returns a CompiledRawPattern that is prepended to config.compiledRawPatterns
// for the current session, or null if inference fails or no provider is set.
// ---------------------------------------------------------------------------

const INFERENCE_SAMPLE_SIZE = 20;

export async function inferFormat(
  lines: string[],
  config: RuntimeLogclawConfig,
): Promise<CompiledRawPattern | null> {
  const provider = resolveProvider();
  if (!provider) return null;

  const sample = lines
    .filter((l) => l.trim().length > 0)
    .slice(0, INFERENCE_SAMPLE_SIZE);

  if (sample.length === 0) return null;

  const knownNames = config.compiledRawPatterns.map((p) => p.name);
  const prompt = buildPrompt(sample, knownNames);

  try {
    const response =
      provider === "openai"
        ? await callOpenAI(prompt)
        : await callAnthropic(prompt);

    return parseResponse(response.trim(), config);
  } catch {
    return null;
  }
}

function buildPrompt(lines: string[], knownNames: string[]): string {
  return [
    "You are a log format detection assistant.",
    "Given these sample log lines, identify the format.",
    "",
    `If the lines match a known format (${knownNames.join(", ")}),`,
    "respond with just that format name and nothing else.",
    "",
    "If the lines are a custom format, respond with a single-line JSON object:",
    '{"name":"custom","pattern":"regex with named capture groups (?<timestamp>...) (?<level>...) (?<message>...)"}',
    "",
    "Rules: use named capture groups only. (?<message>...) is required. (?<timestamp>...) and (?<level>...) are optional.",
    "If you cannot identify any pattern, respond with exactly: unknown",
    "",
    "Sample lines:",
    ...lines,
  ].join("\n");
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
        return {
          name: parsed.name ?? "ai-inferred",
          pattern: parsed.pattern,
          regex: new RegExp(parsed.pattern, "i"),
        };
      }
    } catch {
      // fall through
    }
  }

  return null;
}

type Provider = "openai" | "anthropic";

function resolveProvider(): Provider | null {
  const requested = process.env.LOGCLAW_AI_PROVIDER?.trim().toLowerCase();
  if (requested === "openai") return process.env.OPENAI_API_KEY ? "openai" : null;
  if (requested === "anthropic") return anthropicKey() ? "anthropic" : null;

  if (process.env.OPENAI_API_KEY) return "openai";
  if (anthropicKey()) return "anthropic";
  return null;
}

function anthropicKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
}

async function callOpenAI(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY!;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: prompt, max_output_tokens: 200 }),
  });
  if (!response.ok) throw new Error(`OpenAI API ${response.status}`);
  const body = (await response.json()) as { output_text?: string };
  return body.output_text?.trim() ?? "";
}

async function callAnthropic(prompt: string): Promise<string> {
  const apiKey = anthropicKey()!;
  const model =
    process.env.ANTHROPIC_MODEL ||
    process.env.CLAUDE_MODEL ||
    "claude-sonnet-4-20250514";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic API ${response.status}`);
  const body = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  return body.content
    .filter((i) => i.type === "text")
    .map((i) => i.text)
    .join("")
    .trim();
}
