import { LogEntry } from "../parser/types.js";

// ---------------------------------------------------------------------------
// The AI investigator. This is logclaw's headline feature and the reason it
// exists alongside hl/lnav — none of them have it. Wired to mirror the AI-hook
// pattern in the other Claw tools and intended to route through psclawmcp.
//
// Direct provider support lives here for local-first use. psclawmcp wiring can
// still be added later if you want the wider Claw toolchain to own model access.
// ---------------------------------------------------------------------------

export interface SummarizeOptions {
  /** Cap how many entries we send to the model. */
  maxEntries: number;
  /** Bias the digest toward problems. */
  errorsOnly: boolean;
}

const DEFAULTS: SummarizeOptions = {
  maxEntries: 500,
  errorsOnly: false,
};

export async function summarize(
  entries: LogEntry[],
  options: Partial<SummarizeOptions> = {},
): Promise<string> {
  const opts = { ...DEFAULTS, ...options };

  const relevant = (
    opts.errorsOnly
      ? entries.filter((e) => e.level === "error" || e.level === "fatal")
      : entries
  ).slice(-opts.maxEntries);

  if (relevant.length === 0) {
    return "Nothing notable to summarize.";
  }

  const payload = relevant.map((e) => ({
    level: e.level,
    message: e.message,
    timestamp: e.timestamp?.toISOString(),
    repeatCount: e.repeatCount,
    // Include the trace tail if present — usually where the answer is.
    trace:
      typeof e.fields.trace === "string"
        ? (e.fields.trace as string).split("\n").slice(0, 8).join("\n")
        : undefined,
  }));

  const prompt = buildPrompt(payload);
  return callModel(prompt);
}

function buildPrompt(payload: unknown): string {
  return [
    "You are a log triage assistant. Given these recent log entries,",
    "tell me in 3-5 sentences what went wrong, the most likely root cause,",
    "and which entries to look at first. Be concrete.",
    "",
    "Entries:",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

/**
 * TODO: route this through psclawmcp instead of returning a placeholder.
 * The other Claw tools call the MCP server here; mirror that wiring.
 *
 * Sketch:
 *   const res = await psclawmcp.invoke("summarize", { prompt });
 *   return res.text;
 */
async function callModel(prompt: string): Promise<string> {
  const provider = resolveProvider();

  if (!provider) {
    return [
      "[--summarize unavailable]",
      "Set OPENAI_API_KEY or ANTHROPIC_API_KEY (or CLAUDE_API_KEY) in your environment or .env file.",
      "See .env.example for supported variables.",
    ].join("\n");
  }

  try {
    if (provider === "openai") {
      return await callOpenAI(prompt);
    }
    return await callAnthropic(prompt);
  } catch (error) {
    return [
      "[--summarize failed]",
      error instanceof Error ? error.message : String(error),
    ].join("\n");
  }
}

type Provider = "openai" | "anthropic";

function resolveProvider(): Provider | null {
  const requested = process.env.LOGCLAW_AI_PROVIDER?.trim().toLowerCase();
  if (requested === "openai") return process.env.OPENAI_API_KEY ? "openai" : null;
  if (requested === "anthropic") {
    return providerAnthropicKey() ? "anthropic" : null;
  }

  if (process.env.OPENAI_API_KEY) return "openai";
  if (providerAnthropicKey()) return "anthropic";
  return null;
}

async function callOpenAI(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: 400,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
  }

  const body = (await response.json()) as OpenAIResponse;
  const text = body.output_text ?? extractOpenAIText(body);
  if (!text) throw new Error("OpenAI API returned no text output.");
  return text.trim();
}

async function callAnthropic(prompt: string): Promise<string> {
  const apiKey = providerAnthropicKey();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY or CLAUDE_API_KEY is not set.");

  const model = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API ${response.status}: ${await response.text()}`);
  }

  const body = (await response.json()) as AnthropicResponse;
  const text = body.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("Anthropic API returned no text output.");
  return text;
}

function providerAnthropicKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
}

function extractOpenAIText(body: OpenAIResponse): string {
  const parts = body.output?.flatMap((item) => item.content ?? []) ?? [];
  return parts
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

interface OpenAIResponse {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type: string;
      text?: string;
    }>;
  }>;
}

interface AnthropicResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
}
