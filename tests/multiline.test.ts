import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { parseRawLine } from "../src/parser/formats.js";
import { groupMultiline } from "../src/transform/multiline.js";

const config = loadConfig();

describe("groupMultiline", () => {
  it("folds stack traces into the preceding log entry", () => {
    const lines = [
      "ERROR checkout failed",
      "TypeError: Cannot read properties of undefined (reading 'total')",
      "    at computeCart (/app/src/cart.js:42:18)",
      "    at /app/src/routes/checkout.js:17:23",
      "INFO healthcheck ok",
    ];

    const entries = groupMultiline(
      lines,
      (line, lineNo) => parseRawLine(line, lineNo, config),
      config.continuation,
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]?.level).toBe("error");
    expect(entries[0]?.fields.trace).toBe(
      [
        "TypeError: Cannot read properties of undefined (reading 'total')",
        "    at computeCart (/app/src/cart.js:42:18)",
        "    at /app/src/routes/checkout.js:17:23",
      ].join("\n"),
    );
    expect(entries[1]?.message).toBe("INFO healthcheck ok");
  });

  it("does not treat blank lines as continuation", () => {
    const entries = groupMultiline(
      ["ERROR boom", "", "INFO ok"],
      (line, lineNo) => parseRawLine(line, lineNo, config),
      config.continuation,
    );
    expect(entries).toHaveLength(2);
  });

  it("folds multi-line messages using the parsing pattern's continuationPattern", () => {
    const lines = [
      "2026-11-21 11:25:08.052436+0100 0x2a1230   Default     0x0                  0      0    kernel: tcp_connection_summary",
      "so_gencnt: 1940650 t_state: FIN_WAIT_1",
      "rtt: 12.781 ms rttvar: 3.187 ms",
      "2026-11-21 11:25:09.000000+0100 0x2a1230   Error       0x0                  0      0    kernel: next entry",
    ];
    const entries = groupMultiline(
      lines,
      (line, lineNo) => parseRawLine(line, lineNo, config),
      config.continuation,
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]?.pattern).toBe("macos-unified");
    expect(entries[0]?.fields.trace).toBe(
      "so_gencnt: 1940650 t_state: FIN_WAIT_1\nrtt: 12.781 ms rttvar: 3.187 ms",
    );
    expect(entries[1]?.level).toBe("error");
  });

  it("does not apply a pattern's continuationPattern to entries from other patterns", () => {
    const entries = groupMultiline(
      ["ERROR: boom", "so_gencnt: 1940650"],
      (line, lineNo) => parseRawLine(line, lineNo, config),
      config.continuation,
    );
    expect(entries).toHaveLength(2);
  });
});
