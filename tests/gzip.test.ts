import { gzipSync } from "node:zlib";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { isGzip, readFile } from "../src/io/source.js";

describe("isGzip", () => {
  it("detects gzip by magic bytes", () => {
    const buf = gzipSync(Buffer.from("test"));
    expect(isGzip(buf)).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(isGzip(Buffer.from("plain text"))).toBe(false);
  });

  it("detects gzip by .gz extension regardless of content", () => {
    expect(isGzip(Buffer.from("anything"), "file.gz")).toBe(true);
  });
});

describe("readFile gzip", () => {
  let tmpFile: string;

  afterEach(() => {
    try {
      unlinkSync(tmpFile);
    } catch {}
  });

  it("decompresses a .gz file and returns utf8 content", () => {
    const content = '{"level":"info","message":"hello from gzip"}\n';
    tmpFile = join(tmpdir(), `logclaw-gzip-${Date.now()}.log.gz`);
    writeFileSync(tmpFile, gzipSync(Buffer.from(content)));

    const result = readFile(tmpFile);
    expect(result).toBe(content);
  });
});
