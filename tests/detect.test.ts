import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { detectFormat } from "../src/parser/detect.js";

const samplesDir = join(process.cwd(), "samples");
const config = loadConfig();

function readSample(name: string): string[] {
  return readFileSync(join(samplesDir, name), "utf8").split(/\r?\n/);
}

describe("detectFormat", () => {
  it("detects json samples", () => {
    const result = detectFormat(readSample("json.log"), config);
    expect(result.format).toBe("json");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("detects logfmt samples", () => {
    const result = detectFormat(readSample("logfmt.log"), config);
    expect(result.format).toBe("logfmt");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("detects apache access logs as common", () => {
    const result = detectFormat(readSample("apache.log"), config);
    expect(result.format).toBe("common");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("detects syslog samples", () => {
    const result = detectFormat(readSample("syslog.log"), config);
    expect(result.format).toBe("syslog");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("returns unknown for mixed-format samples", () => {
    const result = detectFormat(readSample("mixed.log"), config);
    expect(result.format).toBe("unknown");
    expect(result.confidence).toBeLessThan(0.6);
  });
});
