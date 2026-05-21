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

    const entries = groupMultiline(lines, (line, lineNo) => parseRawLine(line, lineNo, config));

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
    );
    expect(entries).toHaveLength(2);
  });
});
