import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import {
  parseJsonLine,
  parseLogfmtLine,
  parseLogfmtPairs,
  parseRawLine,
  parserFor,
} from "../src/parser/formats.js";

const config = loadConfig();

describe("parseJsonLine", () => {
  it("extracts structured fields and timestamp", () => {
    const entry = parseJsonLine(
      '{"timestamp":"2026-05-21T09:14:01.221Z","level":"info","message":"server listening","port":3000}',
      1,
      config,
    );

    expect(entry.level).toBe("info");
    expect(entry.message).toBe("server listening");
    expect(entry.timestamp?.toISOString()).toBe("2026-05-21T09:14:01.221Z");
    expect(entry.fields).toEqual({ port: 3000 });
  });

  it("falls back to raw parsing on invalid json", () => {
    const entry = parseJsonLine('{"level":"error"', 7, config);

    expect(entry.lineNo).toBe(7);
    expect(entry.level).toBe("error");
    expect(entry.message).toBe('{"level":"error"');
    expect(entry.fields).toEqual({});
  });
});

describe("parseLogfmtPairs", () => {
  it("parses quoted and bare values", () => {
    expect(
      parseLogfmtPairs(
        'time=2026-05-21T09:14:01.221Z level=info msg="server listening" request_id=req_123',
      ),
    ).toEqual({
      time: "2026-05-21T09:14:01.221Z",
      level: "info",
      msg: "server listening",
      request_id: "req_123",
    });
  });
});

describe("parseLogfmtLine", () => {
  it("extracts canonical fields and leaves extras", () => {
    const entry = parseLogfmtLine(
      'time=2026-05-21T09:14:01.221Z level=warn msg="slow query" ms=812 query="SELECT * FROM orders"',
      5,
      config,
    );

    expect(entry.level).toBe("warn");
    expect(entry.message).toBe("slow query");
    expect(entry.timestamp?.toISOString()).toBe("2026-05-21T09:14:01.221Z");
    expect(entry.fields).toEqual({
      ms: "812",
      query: "SELECT * FROM orders",
    });
  });
});

describe("parseRawLine", () => {
  it("sniffs level from unstructured lines", () => {
    const entry = parseRawLine("2026-05-21 09:14:06 ERROR checkout failed", 3, config);
    expect(entry.level).toBe("error");
    expect(entry.message).toBe("2026-05-21 09:14:06 ERROR checkout failed");
    expect(entry.timestamp).toBeUndefined();
  });

  it("returns unknown level when no level token exists", () => {
    const entry = parseRawLine("Started background sync worker.", 9, config);
    expect(entry.level).toBe("unknown");
  });

  it("extracts structured fields from configured syslog patterns", () => {
    const entry = parseRawLine(
      "May 21 09:14:01 web-01 systemd[1]: Started Logclaw Demo API.",
      1,
      config,
    );

    expect(entry.message).toBe("Started Logclaw Demo API.");
    expect(entry.timestamp?.toISOString()).toContain("T09:14:01.000Z");
    expect(entry.fields).toEqual({
      host: "web-01",
      tag: "systemd[1]",
    });
  });
});

describe("parserFor", () => {
  it("returns callable parsers for all formats", () => {
    expect(typeof parserFor("json", config)).toBe("function");
    expect(typeof parserFor("logfmt", config)).toBe("function");
    expect(typeof parserFor("common", config)).toBe("function");
    expect(typeof parserFor("syslog", config)).toBe("function");
    expect(typeof parserFor("unknown", config)).toBe("function");
  });
});
