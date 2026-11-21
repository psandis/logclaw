import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import { summarize } from "../src/ai/summarize.js";
import { LogEntry } from "../src/parser/types.js";

const config = loadConfig();

const AI_ENV = [
  "LOGCLAW_AI_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "ANTHROPIC_API_KEY",
  "CLAUDE_API_KEY",
  "ANTHROPIC_MODEL",
  "CLAUDE_MODEL",
];

function clearAiEnv(): void {
  for (const name of AI_ENV) delete process.env[name];
}

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    raw: "raw",
    lineNo: 1,
    level: "error",
    message: "checkout failed",
    fields: {},
    ...overrides,
  };
}

describe("summarize", () => {
  // Clear before as well as after, so a real key in the shell never reaches a test.
  beforeEach(clearAiEnv);
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearAiEnv();
  });

  it("returns a helpful message when no provider keys are configured", async () => {
    const result = await summarize([entry()], config);
    expect(result).toContain("[--summarize unavailable]");
    expect(result).toContain("OPENAI_API_KEY, ANTHROPIC_API_KEY, CLAUDE_API_KEY");
    expect(result).toContain(".env.example");
  });

  it("calls the OpenAI responses API when OPENAI_API_KEY is set", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: "Root cause: checkout total was undefined." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await summarize([entry()], config);

    expect(result).toBe("Root cause: checkout total was undefined.");
    expect(fetchMock).toHaveBeenCalledWith(
      config.ai.providers.openai!.url,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-key",
        }),
      }),
    );
  });

  it("reads OpenAI text from the output array when output_text is absent", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [{ content: [{ type: "output_text", text: "From the output array." }] }],
      }),
    }));

    const result = await summarize([entry()], config);
    expect(result).toBe("From the output array.");
  });

  it("calls the Anthropic messages API when configured", async () => {
    process.env.LOGCLAW_AI_PROVIDER = "anthropic";
    process.env.CLAUDE_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "Most likely root cause is a bad checkout payload." }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await summarize([entry()], config);

    expect(result).toBe("Most likely root cause is a bad checkout payload.");
    expect(fetchMock).toHaveBeenCalledWith(
      config.ai.providers.anthropic!.url,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "test-key",
          "anthropic-version": config.ai.providers.anthropic!.apiVersion,
        }),
      }),
    );
  });

  it("uses the model and token limit from config", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: "ok" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await summarize([entry()], config);

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body.model).toBe(config.ai.providers.openai!.defaultModel);
    expect(body.max_output_tokens).toBe(config.ai.summarize.maxTokens);
    expect(body.input).toContain("You are a log triage assistant.");
    expect(body.input).toContain('"message": "checkout failed"');
  });
});
