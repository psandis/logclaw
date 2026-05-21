# logclaw

[![npm](https://img.shields.io/npm/v/logclaw?style=flat-square)](https://www.npmjs.com/package/logclaw)

A Node-native log investigator for the terminal. It eats messy, half-structured
app output — the stuff `console.log` and framework loggers actually emit — and
turns it into something readable: stack traces folded into single events,
noisy repeats collapsed, levels colorized. Plus an AI digest of what went wrong.

## What It Does

- reads logs from a file or stdin
- detects `json`, `logfmt`, `common`, and `syslog` formats automatically
- normalizes raw framework-style logs through config-driven regex patterns
- folds stack traces into single events instead of shredding them line by line
- collapses consecutive duplicate entries into `(×N)` badges
- renders readable terminal output with timestamps, levels, and extra fields
- generates AI summaries of failures through `--summarize` when provider keys are configured

## Why this exists

The terminal log space is crowded but lopsided. `lnav` (~10k stars, C++) owns
interactive investigation. `hl` (~3k stars, Rust) owns fast JSON/logfmt
reformatting. Both are excellent and you will not out-perform them on raw speed.

The gaps they leave:

1. **Unstructured app output.** `hl` only speaks JSON and logfmt. The messy
   reality — raw stdout, ad-hoc logger lines, multi-line Node/Java/Python stack
   traces — is unserved. That's logclaw's primary target.
2. **No AI, anywhere.** None of the incumbents summarize or triage. logclaw's
   `--summarize` is the headline, not a bolt-on.
3. **No Node-native option.** Every serious tool is Rust/C++/Go. "Runs in the
   runtime my app already uses, `npm i -g`, just works" is an open lane.

logclaw does **not** try to win on throughput against a multithreaded Rust tool.
It wins on handling the mess and on the AI investigator.

## Requirements

- Node 22+

## Install

```bash
npm install
npm run build
```

## Quick Start

```bash
npm start -- samples/json.log
lclaw samples/json.log
```

Run other formats:

```bash
node dist/index.js samples/logfmt.log
node dist/index.js samples/spring-boot.log
node dist/index.js samples/syslog.log
OPENAI_API_KEY=... node dist/index.js samples/spring-boot.log --summarize
```

Read from stdin:

```bash
cat samples/json.log | npm run dev
kubectl logs my-pod | npm run dev -- --level warn
```

Development from source:

```bash
npm run dev -- samples/json.log
```

## Quick Commands

| Command | Purpose | Result |
|---------|---------|--------|
| `lclaw samples/json.log` | parse the default JSON fixture | readable terminal output with grouping and repeat collapsing |
| `lclaw samples/logfmt.log` | parse logfmt fixture | key/value fields rendered inline |
| `lclaw samples/syslog.log` | parse syslog fixture | regex-driven normalization of syslog-style lines |
| `lclaw samples/spring-boot.log --summarize` | run AI triage on a framework log sample | short root-cause summary |
| `lclaw samples/spring-boot.log --summarize --errors-only` | summarize only failures | tighter AI output focused on error events |
| `cat samples/json.log | lclaw` | read logs from stdin | same render pipeline without a file path |
| `npm test` | run automated tests | Vitest suite result |
| `npm run typecheck` | verify TypeScript correctness | compile check without emit |

## Sample Fixtures

Fixtures live in [`samples/`](/Users/petrisandholm/Projects/psandis-projects/logclaw/samples). Use them to verify each supported format family:

| File | Format | What it proves |
|------|--------|----------------|
| `json.log` | JSON | structured parsing, repeat collapsing, stack-trace grouping |
| `logfmt.log` | logfmt | key/value parsing, extras rendering, repeat collapsing |
| `apache.log` | Apache access + error | common-log detection plus regex-driven raw parsing |
| `nginx.log` | nginx access + error | common-log detection plus regex-driven raw parsing |
| `syslog.log` | RFC3164 syslog | syslog detection plus regex-driven raw parsing |
| `spring-boot.log` | Spring Boot | regex-driven raw parsing and Java stack-trace grouping |
| `laravel.log` | Laravel | regex-driven raw parsing |
| `python.log` | Python logging | regex-driven raw parsing and traceback grouping |
| `mixed.log` | mixed formats | fallback behavior when one file mixes multiple styles |

Run them directly:

```bash
node dist/index.js samples/json.log
node dist/index.js samples/logfmt.log
node dist/index.js samples/apache.log
node dist/index.js samples/syslog.log
```

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev -- <file>` | run from source through `tsx` |
| `npm run build` | compile TypeScript to `dist/` |
| `npm start -- <file>` | run the built CLI from `dist/index.js` |
| `npm test` | run the Vitest suite |
| `npm run typecheck` | run TypeScript compile checks without emitting |

After build, both `logclaw` and `lclaw` point to the same CLI.

## Usage

```
logclaw [file] [options]
lclaw [file] [options]

  -l, --level <level>   minimum level to show (trace|debug|info|warn|error|fatal)
      --format <fmt>    force format instead of auto-detect (json|logfmt|common|syslog)
      --no-color        disable ANSI colors
      --no-group        disable multiline / stack-trace grouping
      --no-collapse     disable consecutive-repeat collapsing
      --no-trace        hide grouped stack traces
      --summarize       print an AI digest of what went wrong
      --errors-only     with --summarize, only feed error/fatal entries
```

Set `LOGCLAW_DEBUG=1` to print the detected format + confidence to stderr.

## Config

Default behavior is defined in [`data/defaults.jsonc`](/Users/petrisandholm/Projects/psandis-projects/logclaw/data/defaults.jsonc).

It defines:

- detection thresholds
- structured field aliases
- regex-driven raw log patterns
- level normalization aliases
- renderer defaults

The runtime loads this file once at startup and threads it through detection, parsing, level normalization, and rendering.

What the config file controls:

| Section | Purpose |
|---------|---------|
| `detection` | sample size and confidence threshold for format detection |
| `parsers.fieldMappings` | which keys count as level, message, and timestamp in structured logs |
| `rawPatterns` | ordered regex profiles for raw framework and server log formats |
| `levelAliases` | mapping from raw level words to canonical logclaw levels |
| `render.timestampSlice` | which part of the timestamp string is shown in terminal output |
| `render.levelColors` | per-level terminal color selection |

Editing the config file changes behavior without touching parser or renderer code.

## AI Setup

Create a local `.env` from [`.env.example`](/Users/petrisandholm/Projects/psandis-projects/logclaw/.env.example) to enable `--summarize`.

Supported variables:

| Variable | What it does |
|----------|--------------|
| `LOGCLAW_AI_PROVIDER` | optional override: `openai` or `anthropic` |
| `OPENAI_API_KEY` | enables OpenAI-backed summaries |
| `OPENAI_MODEL` | OpenAI model id, defaults to `gpt-4.1-mini` |
| `ANTHROPIC_API_KEY` | enables Anthropic-backed summaries |
| `CLAUDE_API_KEY` | alias for `ANTHROPIC_API_KEY` |
| `ANTHROPIC_MODEL` | Anthropic model id, defaults to `claude-sonnet-4-20250514` |
| `CLAUDE_MODEL` | alias for `ANTHROPIC_MODEL` |

Example:

```bash
cp .env.example .env
node dist/index.js samples/spring-boot.log --summarize
```

AI usage examples:

```bash
lclaw samples/spring-boot.log --summarize
lclaw samples/spring-boot.log --summarize --errors-only
cat samples/json.log | lclaw --summarize
LOGCLAW_AI_PROVIDER=anthropic lclaw samples/laravel.log --summarize
```

What `--summarize` produces:

- a short plain-text triage summary
- the most likely root cause
- which entries to inspect first
- better signal when combined with `--errors-only`

Example AI summary output:

```text
The checkout flow is failing because the application tries to read `total` from an undefined cart object during request handling. The primary failure is the `TypeError` in `computeCart`, which then surfaces as an unhandled rejection in `/checkout`. Start with the error event at 09:14:06.440 and the attached stack trace, especially `/app/src/cart.js:42` and `/app/src/routes/checkout.js:17`. The repeated healthcheck lines are unrelated noise.
```

## Project Structure

```text
logclaw/
├── data/
│   └── defaults.jsonc
├── .env.example
├── .gitignore
├── samples/
│   ├── apache.log
│   ├── json.log
│   ├── laravel.log
│   ├── logfmt.log
│   ├── mixed.log
│   ├── nginx.log
│   ├── python.log
│   ├── spring-boot.log
│   └── syslog.log
├── src/
│   ├── ai/
│   ├── parser/
│   ├── render/
│   ├── transform/
│   └── index.ts
├── tests/
│   ├── collapse.test.ts
│   ├── detect.test.ts
│   ├── fixtures.test.ts
│   ├── formats.test.ts
│   └── multiline.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Related Projects

Other OpenClaw projects:

- [dustclaw](https://github.com/psandis/dustclaw) - disk space analyzer and cleanup CLI
- [dietclaw](https://github.com/psandis/dietclaw) - codebase health and dependency bloat monitor
- [feedclaw](https://github.com/psandis/feedclaw) - RSS/Atom reader and AI digest builder
- [wirewatch](https://github.com/psandis/wirewatch) - network traffic monitoring with AI-assisted anomaly detection
- [driftclaw](https://github.com/psandis/driftclaw) - version drift inspection across environments
- [speak2text](https://github.com/psandis/speak2text) - speech-to-text CLI
- [text2speak](https://github.com/psandis/text2speak) - text-to-speech CLI
- [asciiclaw](https://github.com/psandis/asciiclaw) - image to ASCII art terminal converter
- [unasciiclaw](https://github.com/psandis/unasciiclaw) - ASCII art to image converter
- [mymailclaw](https://github.com/psandis/mymailclaw) - email scanner, categorizer, and cleaner CLI

## How It Works

```
source lines
   │
   ▼
detect format        src/parser/detect.ts   ← samples first ~50 lines, scores each format
   │
   ▼
parse per line       src/parser/formats.ts  ← json / logfmt / raw fallback
   │
   ▼
group multiline      src/transform/multiline.ts  ← folds stack traces into one entry
   │
   ▼
collapse repeats     src/transform/collapse.ts   ← "(×N)" instead of N identical lines
   │
   ▼
render / summarize   src/render/pretty.ts , src/ai/summarize.ts
```

`json` and `logfmt` have dedicated parsers. `common`, `syslog`, and framework-style raw logs are normalized through config-driven regex patterns plus multiline grouping.

## Example Output

`samples/json.log` is the quick demo fixture used in the README flow:

```text
09:14:01.221 INFO   server listening  port=3000
09:14:02.882 INFO   healthcheck ok (×3)
09:14:05.101 WARN   slow query  ms=812 query=SELECT * FROM orders
09:14:06.440 ERROR  unhandled rejection in /checkout
TypeError: Cannot read properties of undefined (reading 'total')
    at computeCart (/app/src/cart.js:42:18)
    at /app/src/routes/checkout.js:17:23
    at processTicksAndRejections (node:internal/process/task_queues:95:5)
09:14:07.000 INFO   healthcheck ok
```

## Roadmap

- [ ] Optional: route `src/ai/summarize.ts` through **psclawmcp** instead of direct provider calls.
- [ ] AI format-inference fallback when detection returns `unknown`.
- [ ] Dedicated `common` (Apache/nginx) and `syslog` parsers (detection exists,
      parsers fall back to raw for now).
- [ ] `-f, --follow` live tail mode (TTY-aware), the easy 20%.
- [ ] Register logclaw as a tool in `psclawmcp`.
- [ ] Compressed input (`.gz`) support.

## Notes

- npm name to confirm. Backup naming if taken: `logsclaw` / `clawlog`.
- ESM, `"type": "module"`, NodeNext resolution — relative imports use `.js`.

## License

MIT
