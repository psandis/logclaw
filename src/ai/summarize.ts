import { RuntimeLogclawConfig } from "../config.js";
import { LogEntry } from "../parser/types.js";
import { apiKeyEnvNames, complete, fillPrompt, resolveProvider } from "./provider.js";

// ---------------------------------------------------------------------------
// The AI investigator (--summarize). Limits and the prompt come from
// config.ai.summarize; provider access from config.ai.providers.
// ---------------------------------------------------------------------------

export interface SummarizeOptions {
  /** Bias the digest toward problems. */
  errorsOnly: boolean;
}

export async function summarize(
  entries: LogEntry[],
  config: RuntimeLogclawConfig,
  options: Partial<SummarizeOptions> = {},
): Promise<string> {
  const settings = config.ai.summarize;

  const relevant = (
    options.errorsOnly
      ? entries.filter((e) => e.level === "error" || e.level === "fatal")
      : entries
  ).slice(-settings.maxEntries);

  if (relevant.length === 0) {
    return "Nothing notable to summarize.";
  }

  const payload = relevant.map((e) => ({
    level: e.level,
    message: e.message,
    timestamp: e.timestamp?.toISOString(),
    repeatCount: e.repeatCount,
    // The first trace lines usually hold the exception and the failing frame.
    trace:
      typeof e.fields.trace === "string"
        ? e.fields.trace.split("\n").slice(0, settings.traceLines).join("\n")
        : undefined,
  }));

  const provider = resolveProvider(config);
  if (!provider) {
    return [
      "[--summarize unavailable]",
      `Set one of ${apiKeyEnvNames(config).join(", ")} in your environment or .env file.`,
      "See .env.example for supported variables.",
    ].join("\n");
  }

  const prompt = fillPrompt(settings.prompt, {
    entries: JSON.stringify(payload, null, 2),
  });

  try {
    return await complete(provider, prompt, settings.maxTokens);
  } catch (error) {
    return [
      "[--summarize failed]",
      error instanceof Error ? error.message : String(error),
    ].join("\n");
  }
}
