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
  it("extracts timestamp and level from unstructured lines with the fallback", () => {
    const entry = parseRawLine("2026-05-21 09:14:06 ERROR checkout failed", 3, config);
    expect(entry.level).toBe("error");
    expect(entry.message).toBe("checkout failed");
    expect(entry.timestamp?.toISOString()).toBe("2026-05-21T09:14:06.000Z");
  });

  it.each([
    ["[2026-08-13 05:59:53.551] [info]  [AppUpdater] Checking for updates", "info", "[AppUpdater] Checking for updates", "05:59:53.551"],
    ["2026-11-21 09:49:54.363882 (gui/501/app [52067]) <Notice>: job state = exited", "info", "job state = exited", "09:49:54.363"],
    ["2026-01-16 11:27:21,684 [      5]   INFO - #c.i.p.AppStarter - IDE STARTED", "info", "#c.i.p.AppStarter - IDE STARTED", "11:27:21.684"],
    ["[2025-04-14T11:29:36.381Z] (blob-extension:69370) <INFO> Loading SSL Settings", "info", "Loading SSL Settings", "11:29:36.381"],
    ["[Hotkey] 2026-01-27 20:51:52 [info] No accessibility permissions", "info", "No accessibility permissions", "20:51:52.000"],
    ["2024-11-02 22:06:19:869|SyncServer|3500|0x7c2024000|Server|Warning| No schema plist", "warn", "No schema plist", "22:06:19.869"],
    ["Aug 31 02:22:33 mdmclient[6702] [ERROR] [0:MDMDaemon:<0x7561>] XPC request missing entitlements", "error", "[0:MDMDaemon:<0x7561>] XPC request missing entitlements", "02:22:33.000"],
  ])("fallback parses %s", (line, level, message, time) => {
    const entry = parseRawLine(line, 1, config);
    expect(entry.level).toBe(level);
    expect(entry.message).toBe(message);
    expect(entry.timestamp?.toISOString().slice(11, 23)).toBe(time);
  });

  it.each([
    '{"timestamp":"2026-05-21T09:14:01.221Z","level":"info","message":"server listening","port":3000}',
    'time=2026-05-21T09:14:02.882Z level=info msg="healthcheck ok" route=/healthz',
  ])("never cuts a timestamp out of JSON or logfmt text: %s", (line) => {
    // Regression: samples/mixed.log. These lines must stay intact.
    expect(parseRawLine(line, 1, config).message).toBe(line);
  });

  it("leaves lines without timestamp or level token unchanged", () => {
    const entry = parseRawLine("Can't open /dev/rdisk4s1: Permission denied", 1, config);
    expect(entry.message).toBe("Can't open /dev/rdisk4s1: Permission denied");
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
