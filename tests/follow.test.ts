import { appendFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { parserFor } from "../src/parser/formats.js";
import {
  createFollowContext,
  followFile,
  processLines,
  readNewLines,
} from "../src/transform/follow.js";

const config = loadConfig();
const parseLine = parserFor("json", config);

function tmpLog(): string {
  return join(tmpdir(), `logclaw-follow-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
}

describe("readNewLines", () => {
  let tmpFile: string;
  afterEach(() => { try { unlinkSync(tmpFile); } catch {} });

  it("reads lines and advances the offset", () => {
    tmpFile = tmpLog();
    writeFileSync(tmpFile, '{"level":"info","message":"startup"}\n');

    const ctx = createFollowContext();
    const lines = readNewLines(tmpFile, ctx);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"startup"');
    expect(ctx.offset).toBeGreaterThan(0);
  });

  it("does not re-read already-consumed bytes", () => {
    tmpFile = tmpLog();
    writeFileSync(tmpFile, '{"level":"info","message":"first"}\n');

    const ctx = createFollowContext();
    readNewLines(tmpFile, ctx);

    appendFileSync(tmpFile, '{"level":"warn","message":"second"}\n');
    const lines = readNewLines(tmpFile, ctx);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"second"');
  });
});

describe("processLines", () => {
  it("groups stack trace continuation into the preceding entry", () => {
    const ctx = createFollowContext();
    const lines = [
      '{"level":"error","message":"boom"}',
      "    at doThing (app.js:10:5)",
    ];
    const entries = processLines(lines, ctx, parseLine);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("error");
    expect(entries[0]?.fields.trace).toContain("at doThing");
  });

  it("collapses repeated entries and increments the count across batches", () => {
    const ctx = createFollowContext();
    const batch1 = processLines(['{"level":"info","message":"ping"}'], ctx, parseLine);
    const batch2 = processLines(['{"level":"info","message":"ping"}'], ctx, parseLine);
    const batch3 = processLines(['{"level":"info","message":"ping"}'], ctx, parseLine);

    expect(batch1[0]?.repeatCount).toBeUndefined();
    expect(batch2[0]?.repeatCount).toBe(2);
    expect(batch3[0]?.repeatCount).toBe(3);
  });
});

describe("followFile integration", () => {
  let tmpFile: string;
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    try { unlinkSync(tmpFile); } catch {}
  });

  it("processes initial content then picks up appended lines", async () => {
    tmpFile = tmpLog();
    writeFileSync(tmpFile, '{"level":"info","message":"startup"}\n');

    const received: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout waiting for follow")), 5000);

      stop = followFile(
        tmpFile,
        parseLine,
        (entries) => {
          for (const e of entries) received.push(e.message);
          if (received.includes("startup") && received.includes("appended")) {
            clearTimeout(timeout);
            resolve();
          }
        },
        { interval: 100 },
      );

      setTimeout(() => {
        appendFileSync(tmpFile, '{"level":"warn","message":"appended"}\n');
      }, 200);
    });

    expect(received).toContain("startup");
    expect(received).toContain("appended");
  });
});
