import { RuntimeLogclawConfig } from "../config.js";
import { LogFormat } from "./types.js";
import { parseLogfmtPairs } from "./formats.js";

// ---------------------------------------------------------------------------
// Zero-config format detection. We sample the first N non-empty lines, score
// each candidate format, and pick the winner. If nothing scores well we return
// "unknown" — which is the signal for the AI fallback (see src/ai) to take a
// guess on genuinely weird custom formats.
// ---------------------------------------------------------------------------

export interface DetectionResult {
  format: LogFormat;
  confidence: number; // 0..1
}

export function detectFormat(
  lines: string[],
  config: RuntimeLogclawConfig,
): DetectionResult {
  const sample = lines
    .filter((l) => l.trim().length > 0)
    .slice(0, config.detection.sampleSize);

  if (sample.length === 0) return { format: "unknown", confidence: 0 };

  const scores: Record<Exclude<LogFormat, "unknown">, number> = {
    json: score(sample, looksLikeJson),
    logfmt: score(sample, looksLikeLogfmt),
    common: score(sample, looksLikeCommonLog),
    syslog: score(sample, looksLikeSyslog),
  };

  let best: LogFormat = "unknown";
  let bestScore = 0;
  for (const [fmt, sc] of Object.entries(scores)) {
    if (sc > bestScore) {
      bestScore = sc;
      best = fmt as LogFormat;
    }
  }

  if (bestScore < config.detection.confidenceThreshold) {
    return { format: "unknown", confidence: bestScore };
  }
  return { format: best, confidence: bestScore };
}

function score(sample: string[], test: (line: string) => boolean): number {
  const hits = sample.reduce((n, l) => n + (test(l) ? 1 : 0), 0);
  return hits / sample.length;
}

// --- per-format sniffers ---------------------------------------------------

function looksLikeJson(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

function looksLikeLogfmt(line: string): boolean {
  const pairs = parseLogfmtPairs(line);
  // logfmt lines usually carry several key=value tokens.
  return Object.keys(pairs).length >= 2;
}

// Apache/nginx common log: IP - - [date] "METHOD path proto" status size
const COMMON_LOG_RE =
  /^\S+ \S+ \S+ \[[^\]]+\] "(?:GET|POST|PUT|DELETE|HEAD|PATCH|OPTIONS)[^"]*" \d{3}/;

function looksLikeCommonLog(line: string): boolean {
  return COMMON_LOG_RE.test(line);
}

// RFC3164-ish syslog: "Mon DD HH:MM:SS host process[pid]:"
const SYSLOG_RE =
  /^[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\S+\s+\S+/;

function looksLikeSyslog(line: string): boolean {
  return SYSLOG_RE.test(line);
}
