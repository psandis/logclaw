import { ProviderConfig, RuntimeLogclawConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Shared AI provider access for --summarize and --ai-detect. Provider URLs,
// API versions, key/model environment variables and default models all come
// from config.ai.providers. The code here only knows the two request formats
// ("kind"): OpenAI Responses and Anthropic Messages.
// ---------------------------------------------------------------------------

export interface ResolvedProvider {
  name: string;
  settings: ProviderConfig;
  apiKey: string;
  model: string;
}

/**
 * Pick the provider to use. LOGCLAW_AI_PROVIDER selects one by name; otherwise
 * the first provider in config order that has an API key set is used.
 */
export function resolveProvider(
  config: RuntimeLogclawConfig,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedProvider | null {
  const providers = config.ai.providers;
  const requested = env.LOGCLAW_AI_PROVIDER?.trim().toLowerCase();
  const names = requested && requested in providers ? [requested] : Object.keys(providers);

  for (const name of names) {
    const settings = providers[name];
    if (!settings) continue;
    const apiKey = firstEnv(settings.apiKeyEnv, env);
    if (!apiKey) continue;
    return {
      name,
      settings,
      apiKey,
      model: firstEnv(settings.modelEnv, env) ?? settings.defaultModel,
    };
  }
  return null;
}

/** All environment variable names that can hold an API key, for help messages. */
export function apiKeyEnvNames(config: RuntimeLogclawConfig): string[] {
  return Object.values(config.ai.providers).flatMap((p) => p.apiKeyEnv);
}

/** Send a single prompt and return the model's text. Throws on any failure. */
export async function complete(
  provider: ResolvedProvider,
  prompt: string,
  maxTokens: number,
): Promise<string> {
  switch (provider.settings.kind) {
    case "openai-responses":
      return completeOpenAIResponses(provider, prompt, maxTokens);
    case "anthropic-messages":
      return completeAnthropicMessages(provider, prompt, maxTokens);
    default:
      throw new Error(
        `Provider "${provider.name}" has unsupported kind "${String(provider.settings.kind)}".`,
      );
  }
}

/** Join prompt lines and replace {name} placeholders with values. */
export function fillPrompt(lines: string[], values: Record<string, string>): string {
  return lines
    .join("\n")
    .replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

async function completeOpenAIResponses(
  provider: ResolvedProvider,
  prompt: string,
  maxTokens: number,
): Promise<string> {
  const response = await fetch(provider.settings.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      input: prompt,
      max_output_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    throw new Error(`${provider.name} API ${response.status}: ${await response.text()}`);
  }

  const body = (await response.json()) as OpenAIResponse;
  const text = body.output_text ?? extractOpenAIText(body);
  if (!text) throw new Error(`${provider.name} API returned no text output.`);
  return text.trim();
}

async function completeAnthropicMessages(
  provider: ResolvedProvider,
  prompt: string,
  maxTokens: number,
): Promise<string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": provider.apiKey,
  };
  if (provider.settings.apiVersion) {
    headers["anthropic-version"] = provider.settings.apiVersion;
  }

  const response = await fetch(provider.settings.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: provider.model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`${provider.name} API ${response.status}: ${await response.text()}`);
  }

  const body = (await response.json()) as AnthropicResponse;
  const text = body.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();

  if (!text) throw new Error(`${provider.name} API returned no text output.`);
  return text;
}

function firstEnv(names: string[], env: NodeJS.ProcessEnv): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value) return value;
  }
  return undefined;
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
