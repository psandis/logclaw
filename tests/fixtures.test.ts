import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { detectFormat } from "../src/parser/detect.js";
import { parserFor } from "../src/parser/formats.js";
import { renderAll } from "../src/render/pretty.js";
import { collapseRepeats } from "../src/transform/collapse.js";
import { groupMultiline } from "../src/transform/multiline.js";

const samplesDir = join(process.cwd(), "samples");
const config = loadConfig();

function renderSample(name: string): string {
  const source = readFileSync(join(samplesDir, name), "utf8");
  const lines = source.split(/\r?\n/);
  const format = detectFormat(lines, config).format;
  const parseLine = parserFor(format, config);
  const grouped = groupMultiline(lines, parseLine);
  const collapsed = collapseRepeats(grouped);

  return renderAll(collapsed, {
    color: false,
    config,
    showTrace: true,
  });
}

describe("fixture-driven pipeline", () => {
  it("renders the json sample with grouped traces and repeat badges", () => {
    const rendered = renderSample("json.log");

    expect(rendered).toContain("09:14:01.221 INFO   server listening  port=3000");
    expect(rendered).toContain("09:14:02.882 INFO   healthcheck ok (×3)");
    expect(rendered).toContain("09:14:06.440 ERROR  unhandled rejection in /checkout");
    expect(rendered).toContain("TypeError: Cannot read properties of undefined");
  });

  it("renders the logfmt sample with extras preserved", () => {
    const rendered = renderSample("logfmt.log");

    expect(rendered).toContain("09:14:01.221 INFO   server listening  port=3000 service=api");
    expect(rendered).toContain("09:14:02.882 INFO   healthcheck ok (×3)  route=/healthz");
    expect(rendered).toContain("request_id=req_8f31");
  });

  it("renders syslog samples through configured regex extraction", () => {
    const rendered = renderSample("syslog.log");

    expect(rendered).toContain("09:14:01.000 ·····  Started Logclaw Demo API.  host=web-01 tag=systemd[1]");
    expect(rendered).toContain("09:14:05.000 WARN   WARNING: CPU: 3 PID: 4412 at tcp_send_loss_probe+0x1d2/0x220  host=web-01 tag=kernel");
    expect(rendered).toContain("09:14:06.000 ERROR  E0521 09:14:06.440318    1550 pod_workers.go:1300] \"Error syncing pod, skipping\" err=\"failed to \\\"StartContainer\\\" for \\\"checkout\\\" with CrashLoopBackOff\"  host=web-01 tag=kubelet[1550]");
  });

  it("renders spring boot samples through configured regex extraction", () => {
    const rendered = renderSample("spring-boot.log");

    expect(rendered).toContain("09:14:01.221 INFO   Started Application in 2.618 seconds (process running for 3.104)");
    expect(rendered).toContain("09:14:06.440 ERROR  Unhandled exception during checkout");
    expect(rendered).toContain("java.lang.NullPointerException");
  });
});
