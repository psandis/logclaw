import { RuntimeLogclawConfig } from "../config.js";
import { LogFormat } from "./types.js";
import { isRawParsable, parseLogfmtPairs } from "./formats.js";

// ---------------------------------------------------------------------------
// Zero-config format detection. We sample the first N non-empty lines and
// score each candidate: json, logfmt, the detection patterns (common, syslog),
// and "raw" (lines matched by any config.rawPatterns entry). If nothing scores
// well we return "unknown", which is the signal for the AI fallback (--ai-detect).
// ---------------------------------------------------------------------------

export interface DetectionResult {
  format: LogFormat;
  confidence: number; // 0..1
}

interface Candidate {
  format: LogFormat;
  score: number;
}

export function detectFormat(
  lines: string[],
  config: RuntimeLogclawConfig,
): DetectionResult {
  const sample = headLines(lines, config);

  if (sample.length === 0) return { format: "unknown", confidence: 0 };

  const threshold = config.detection.confidenceThreshold;
  const patterns = config.compiledDetectionPatterns;

  const structured = best([
    { format: "json", score: score(sample, looksLikeJson) },
    {
      format: "logfmt",
      score: score(
        sample,
        (line) => Object.keys(parseLogfmtPairs(line)).length >= config.detection.logfmtMinPairs,
      ),
    },
  ]);
  const named = best([
    { format: "common", score: score(sample, (line) => patterns.common.test(line)) },
    { format: "syslog", score: score(sample, (line) => patterns.syslog.test(line)) },
  ]);
  // Lines matched by a specific rawPatterns entry (not a "fallback": true entry).
  const rawPatterns: Candidate = {
    format: "raw",
    score: score(sample, (line) =>
      config.compiledRawPatterns.some((p) => !p.fallback && p.regex.test(line)),
    ),
  };
  // Lines matched by any rawPatterns entry, including the generic fallback entries.
  const raw: Candidate = {
    format: "raw",
    score: score(sample, (line) => isRawParsable(line, config)),
  };

  // The JSON and logfmt parsers never try rawPatterns. So when explicit raw
  // patterns fit at least as well, use them: a custom format that happens to
  // contain key=value pairs must not be taken over by logfmt. The generic
  // fallback alone never overrides JSON or logfmt (their lines contain timestamps too).
  if (rawPatterns.score >= threshold && rawPatterns.score >= structured.score) {
    // common/syslog are parsed by rawPatterns too, so the output is the same;
    // report the more specific name when its own detection pattern passes.
    return named.score >= threshold
      ? { format: named.format, confidence: named.score }
      : { format: "raw", confidence: rawPatterns.score };
  }

  const winner = best([structured, named, raw]);
  if (winner.score < threshold) {
    return { format: "unknown", confidence: winner.score };
  }
  return { format: winner.format, confidence: winner.score };
}

/**
 * The first config.detection.sampleSize lines that start an entry. Blank lines and
 * continuation lines (stack-trace frames, the rest of a multi-line message) are
 * left out: they belong to the line above and carry no format of their own.
 */
export function headLines(lines: string[], config: RuntimeLogclawConfig): string[] {
  const rules = config.continuation;
  const out: string[] = [];
  let previousPattern: string | undefined;
  let hasPrevious = false;

  for (const line of lines) {
    if (out.length >= config.detection.sampleSize) break;
    if (line.trim().length === 0) continue;

    if (hasPrevious) {
      const own = previousPattern !== undefined ? rules.byPattern.get(previousPattern) : undefined;
      if (rules.patterns.some((re) => re.test(line)) || own?.test(line)) continue;
    }

    out.push(line);
    hasPrevious = true;
    previousPattern = config.compiledRawPatterns.find((p) => p.regex.test(line))?.name;
  }

  return out;
}

function best(candidates: Candidate[]): Candidate {
  let top: Candidate = { format: "unknown", score: 0 };
  for (const c of candidates) {
    if (c.score > top.score) top = c;
  }
  return top;
}

function score(sample: string[], test: (line: string) => boolean): number {
  const hits = sample.reduce((n, l) => n + (test(l) ? 1 : 0), 0);
  return hits / sample.length;
}

// JSON is recognized by parsing, not by a pattern. The regex-based formats
// (common, syslog) and the logfmt pair count come from config.detection.
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
