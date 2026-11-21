import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import { inferFormat } from "../src/ai/infer.js";

const config = loadConfig();

function clearAiEnv(): void {
  for (const name of [
    "LOGCLAW_AI_PROVIDER",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "ANTHROPIC_API_KEY",
    "CLAUDE_API_KEY",
    "ANTHROPIC_MODEL",
    "CLAUDE_MODEL",
  ]) {
    delete process.env[name];
  }
}

describe("inferFormat", () => {
  // Clear before as well as after, so a real key in the shell never reaches a test.
  beforeEach(clearAiEnv);
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearAiEnv();
  });

  it("returns null when no provider key is configured", async () => {
    const result = await inferFormat(["some log line"], config);
    expect(result).toBeNull();
  });

  it("returns an existing compiled pattern when model names a known format", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: "spring-boot" }),
    }));

    const result = await inferFormat(["2026-05-21 09:14:01.221  INFO 1 --- [main] c.e.App : started"], config);

    expect(result).not.toBeNull();
    expect(result?.name).toBe("spring-boot");
    expect(result?.regex).toBeInstanceOf(RegExp);
  });

  it("compiles and returns a new pattern when model returns a JSON object", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const pattern = "^(?<timestamp>\\d+)\\s+(?<level>\\w+)\\s+(?<message>.+)$";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({ name: "epoch-level-msg", pattern }),
      }),
    }));

    const result = await inferFormat(["1716285241 ERROR connection refused"], config);

    expect(result).not.toBeNull();
    expect(result?.name).toBe("epoch-level-msg");
    expect(result?.regex).toBeInstanceOf(RegExp);
    expect(result?.regex.test("1716285241 ERROR connection refused")).toBe(true);
  });

  it("returns null when model responds with unknown", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: "unknown" }),
    }));

    const result = await inferFormat(["xyzzyx gibberish no structure here"], config);
    expect(result).toBeNull();
  });
});
