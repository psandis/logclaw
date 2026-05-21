import { afterEach, describe, expect, it, vi } from "vitest";

import { summarize } from "../src/ai/summarize.js";
import { LogEntry } from "../src/parser/types.js";

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
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOGCLAW_AI_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.CLAUDE_MODEL;
  });

  it("returns a helpful message when no provider keys are configured", async () => {
    const result = await summarize([entry()]);
    expect(result).toContain("[--summarize unavailable]");
    expect(result).toContain(".env.example");
  });

  it("calls the OpenAI responses API when OPENAI_API_KEY is set", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: "Root cause: checkout total was undefined." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await summarize([entry()]);

    expect(result).toBe("Root cause: checkout total was undefined.");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-key",
        }),
      }),
    );
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

    const result = await summarize([entry()]);

    expect(result).toBe("Most likely root cause is a bad checkout payload.");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "test-key",
        }),
      }),
    );
  });
});
