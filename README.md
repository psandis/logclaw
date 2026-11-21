# logclaw

[![npm](https://img.shields.io/npm/v/logclaw?style=flat-square)](https://www.npmjs.com/package/logclaw)

A Node-native log investigator for the terminal. It eats messy, half-structured
app output, the stuff `console.log` and framework loggers actually emit, and
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
   reality, raw stdout, ad-hoc logger lines, and multi-line Node/Java/Python stack
   traces, is unserved. That's logclaw's primary target.
2. **No AI, anywhere.** None of the incumbents summarize or triage. logclaw's
   `--summarize` is the headline, not a bolt-on.
3. **No Node-native option.** Every serious tool is Rust/C++/Go. "Runs in the
   runtime my app already uses, `npm i -g`, just works" is an open lane.

logclaw does **not** try to win on throughput against a multithreaded Rust tool.
It wins on handling the mess and on the AI investigator.

## Requirements

- Node 22+
- pnpm (development only)

## Install

```bash
npm install -g logclaw
```

Both `logclaw` and `lclaw` are available after install.

## Quick Start

```bash
logclaw /var/log/app.log
lclaw /var/log/app.log --level warn
```

Read from stdin:

```bash
cat /var/log/nginx/access.log | logclaw
kubectl logs my-pod | logclaw --level error
docker logs my-container | logclaw --summarize
```

Live tail:

```bash
logclaw /var/log/app.log -f
logclaw /var/log/app.log -f --level warn
```

Compressed files:

```bash
logclaw /var/log/app.log.gz
logclaw archive/app-2026-05-21.log.gz --level error
```

## Development

Clone and run from source:

```bash
git clone https://github.com/psandis/logclaw.git
cd logclaw
pnpm install
pnpm dev samples/json.log
pnpm dev samples/spring-boot.log
pnpm test
pnpm build
```

## Quick Commands

| Command | Purpose | Result |
|---------|---------|--------|
| `lclaw app.log` | parse a log file | readable terminal output with grouping and repeat collapsing |
| `lclaw app.log --level warn` | filter by minimum level | only warn, error, and fatal entries shown |
| `lclaw app.log -f` | live tail a file | new lines rendered as they arrive |
| `lclaw app.log.gz` | read a compressed file | transparent gzip decompression |
| `cat app.log \| lclaw` | read from stdin | same render pipeline without a file path |
| `kubectl logs my-pod \| lclaw --level error` | triage pod logs | errors only, stack traces grouped |
| `lclaw app.log --summarize` | AI triage | short plain-text root-cause summary |
| `lclaw app.log --summarize --errors-only` | AI triage on failures only | tighter digest focused on error events |
| `lclaw app.log --ai-detect` | infer unknown format with AI | pattern applied for the session |
| `pnpm test` | run automated tests (dev) | Vitest suite result |
| `pnpm typecheck` | verify TypeScript correctness (dev) | compile check without emit |

## Sample Fixtures

Fixtures live in [`samples/`](samples/). Use them to verify each supported format family:

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

Run them from the cloned repo:

```bash
pnpm dev samples/json.log
pnpm dev samples/logfmt.log
pnpm dev samples/apache.log
pnpm dev samples/syslog.log
```

## Development Scripts

| Script | What it does |
|--------|--------------|
| `pnpm dev <file>` | run from source through `tsx` (no build needed) |
| `pnpm build` | compile TypeScript to `dist/` |
| `pnpm test` | run the Vitest suite |
| `pnpm typecheck` | TypeScript compile check without emitting |

## Usage

```
logclaw [file] [options]
lclaw [file] [options]

  -l, --level <level>   minimum level to show (trace|debug|info|warn|error|fatal)
      --format <fmt>    force format instead of auto-detect (json|logfmt|common|syslog|raw|unknown)
      --config <path>   extra config file merged on top of the defaults and user config
  -f, --follow          watch the file for new lines and render them as they arrive
      --no-color        disable ANSI colors
      --no-group        disable multiline / stack-trace grouping
      --no-collapse     disable consecutive-repeat collapsing
      --no-trace        hide grouped stack traces
      --summarize       print an AI digest of what went wrong
      --errors-only     with --summarize, only feed error/fatal entries
      --ai-detect       use AI to infer format when auto-detection returns unknown
```

Set `LOGCLAW_DEBUG=1` to print the loaded config files and the detected format + confidence to stderr.

### Input and errors

Pass a file, or pipe logs in. Running `logclaw` in a terminal with neither prints an error and the help text and exits with code 1:

```text
error: no input. Pass a log file, or pipe logs in (cat app.log | logclaw).
```

An empty file or empty pipe prints `warning: <file> has no log lines.` to stderr. A missing file, an unreadable stdin, or a broken config file prints an error and exits with code 1. When no format matches most lines, a warning on stderr says so; unmatched lines are shown as-is.

### macOS logs

Pipe the unified log into logclaw (use `/usr/bin/log`, since `log` is a shell built-in in zsh):

```bash
/usr/bin/log show --last 10m | lclaw --level error
/usr/bin/log show --last 10m --style compact | lclaw
/usr/bin/log show --last 10m --style syslog | lclaw
/usr/bin/log show --last 10m --style ndjson | lclaw
/usr/bin/log stream | lclaw
```

Log files in `/var/log` work directly, for example `install.log`, `wifi.log`, `system.log`, and daemon logs such as `keybagd.log.0`:

```bash
lclaw /var/log/install.log
lclaw /var/log/wifi.log --level warn
```

Rotated `.bz2` files are not supported; decompress them first with `bunzip2 -k`.

### Live tail

Watch a file and render new lines as they arrive:

```bash
lclaw /var/log/app.log -f
lclaw /var/log/app.log -f --level warn
kubectl logs -f my-pod > /tmp/pod.log && lclaw /tmp/pod.log -f
```

`--follow` requires a file path. Stack-trace grouping and repeat collapsing work the same as in batch mode, carrying state across watch callbacks.

### Compressed input

Pass a `.gz` file directly and logclaw decompresses it transparently:

```bash
lclaw /var/log/nginx/access.log.gz
lclaw archive/app-2026-05-21.log.gz --level error
cat backup.log.gz | lclaw
```

Both file and stdin paths are supported. Detection is by `.gz` extension or gzip magic bytes.

### AI format inference

When auto-detection returns `unknown` and you have a provider key configured, `--ai-detect` sends a sample of lines to the model and applies the inferred pattern for the session:

```bash
lclaw custom-app.log --ai-detect
LOGCLAW_DEBUG=1 lclaw custom-app.log --ai-detect
lclaw custom-app.log --ai-detect --summarize
```

Requires `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in your environment or `.env` file. The inferred pattern is session-only and is not saved to any config file.

## Configuration

All behavior is config driven: format detection, timestamp formats, raw log patterns, level words, stack-trace grouping, rendering, follow mode, and AI providers and prompts. The built-in defaults live in [`data/defaults.jsonc`](data/defaults.jsonc), which documents every setting.

### Config files

Config is loaded in layers. Each layer is merged on top of the previous one:

1. Built-in defaults: `data/defaults.jsonc` (part of the package, do not edit)
2. User config file, if it exists:

   | Platform | Path |
   |----------|------|
   | macOS / Linux | `~/.config/logclaw/config.jsonc` (or `$XDG_CONFIG_HOME/logclaw/config.jsonc`) |
   | Windows | `%APPDATA%\logclaw\config.jsonc` |

3. Extra config file from `--config <path>`, or from the `LOGCLAW_CONFIG` environment variable when `--config` is not given. The file must exist.

Create the user config file:

```bash
# macOS / Linux
mkdir -p ~/.config/logclaw
touch ~/.config/logclaw/config.jsonc
```

```powershell
# Windows (PowerShell)
New-Item -ItemType Directory -Force "$env:APPDATA\logclaw"
New-Item -ItemType File "$env:APPDATA\logclaw\config.jsonc"
```

Config files are JSONC: JSON with `//` and `/* */` comments. Trailing commas are not allowed. Run with `LOGCLAW_DEBUG=1` to see which files were loaded.

### Merge rules

You only write the settings you want to change:

- Objects merge key by key.
- `rawPatterns` and `timestamps.patterns`: your entries are tried first. An entry with the same `name` as a built-in one replaces it.
- `parsers.fieldMappings.*`, `levelAliases.*` and `multiline.continuationPatterns`: your values are added to the built-in ones.
- Every other list replaces the built-in list.

A broken regex or unreadable file stops logclaw at startup with an error naming the file or pattern.

### Example

Support a custom `<LEVEL> message` format, read `severity_text` as a level field, and change two colors:

```jsonc
// ~/.config/logclaw/config.jsonc
{
  "rawPatterns": [
    {
      "name": "my-app",
      "example": "<ERROR> disk full",
      "pattern": "^<(?<level>\\w+)> (?<message>.+)$"
    }
  ],
  "parsers": {
    "fieldMappings": { "level": ["severity_text"] }
  },
  "render": {
    "levelColors": { "info": "cyan", "fatal": "bgMagenta.white" }
  }
}
```

### Settings

| Section | Controls |
|---------|----------|
| `input.skipPatterns` | regexes for lines to drop before parsing, such as column headers |
| `detection` | sample size, confidence threshold, logfmt pair count, and the regexes that recognize `common` and `syslog` |
| `parsers.fieldMappings` | which keys count as level, message, and timestamp in JSON and logfmt |
| `parsers.epochMillisThreshold` | where numeric timestamps switch from seconds to milliseconds |
| `timestamps` | month names and the ordered timestamp formats (named groups: year, month, day, hour, minute, second, fraction, offset; a time without a date uses today's date) |
| `rawPatterns` | ordered regex profiles for log formats; optional `flags` (default `i`), `levels`, `continuationPattern`, and `fallback` per entry |
| `levelSniff` | the regex that finds a level word in lines without a level field |
| `levelAliases` | mapping from raw level words to canonical logclaw levels |
| `multiline.continuationPatterns` | regexes for lines that belong to the previous entry's stack trace |
| `render` | timestamp slice, time zone, missing-timestamp text, level labels and colors, repeat badge, hidden and empty fields, and the timestamp, badge, field, and trace styles |
| `follow.pollIntervalMs` | how often `--follow` checks the file |
| `ai.providers` | provider endpoints, API version, API key and model environment variables, and default models |
| `ai.summarize` | entry limit, trace lines per entry, token limit, and prompt for `--summarize` |
| `ai.infer` | sample size, token limit, and prompt for `--ai-detect` |

Styles are chalk style names chained with dots, for example `red`, `dim.italic`, or `bgRed.white`.

### Adding a log format

A new format is a `rawPatterns` entry in your config, with no code change:

```jsonc
{
  "rawPatterns": [
    {
      "name": "my-service",
      "example": "2026-05-21 09:14:01 <E> payment failed",
      "pattern": "^(?<timestamp>\\S+ \\S+) <(?<level>\\w+)> (?<message>.+)$",
      "levels": { "E": "error", "W": "warn", "I": "info" }
    }
  ]
}
```

- Named groups `timestamp`, `level`, and `message` are used for the entry; any other named group becomes a field.
- `levels` maps level words for this pattern only. Without it, `levelAliases` is used.
- `continuationPattern` folds following lines into the entry, for messages that span lines.
- Entries are tried in order and the first match wins. Your entries are tried before the built-in ones.
- The generic built-in entries marked `"fallback": true` (at the end of the list) catch common shapes: a timestamp at the line start followed by a level like `[info]`, `<Notice>`, `|Warning|`, or `INFO -`.

## AI Setup

Create a local `.env` from [`.env.example`](.env.example) to enable `--summarize`.

Supported variables:

| Variable | What it does |
|----------|--------------|
| `LOGCLAW_AI_PROVIDER` | optional override: `openai` or `anthropic` (any name under `ai.providers`) |
| `OPENAI_API_KEY` | enables OpenAI-backed summaries |
| `OPENAI_MODEL` | OpenAI model id, defaults to `gpt-4.1-mini` |
| `ANTHROPIC_API_KEY` | enables Anthropic-backed summaries |
| `CLAUDE_API_KEY` | alias for `ANTHROPIC_API_KEY` |
| `ANTHROPIC_MODEL` | Anthropic model id, defaults to `claude-sonnet-4-20250514` |
| `CLAUDE_MODEL` | alias for `ANTHROPIC_MODEL` |

These variable names, the default models, and the endpoints are set under `ai.providers` in the config. Without `LOGCLAW_AI_PROVIDER`, the first provider with a key set is used, in config order.

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
├── bin/
│   ├── lclaw.js
│   └── logclaw.js
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
│   ├── io/
│   ├── parser/
│   ├── render/
│   ├── transform/
│   ├── config.ts
│   ├── env.ts
│   └── index.ts
├── tests/
│   ├── ai-infer.test.ts
│   ├── collapse.test.ts
│   ├── config.test.ts
│   ├── detect.test.ts
│   ├── fixtures.test.ts
│   ├── follow.test.ts
│   ├── formats.test.ts
│   ├── gzip.test.ts
│   ├── multiline.test.ts
│   ├── patterns.test.ts
│   └── summarize.test.ts
├── CHANGELOG.md
├── LICENSE
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
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

- [x] `-f, --follow` live tail mode.
- [x] Compressed input (`.gz`): transparent decompression for files and stdin.
- [x] `--ai-detect` format inference when auto-detection returns `unknown`.
- [x] User config file and `--config` override, with everything config driven.
- [ ] Optional: route `src/ai/provider.ts` through **psclawmcp** instead of direct provider calls.
- [ ] Dedicated `common` (Apache/nginx) and `syslog` parsers (detection exists, parsers fall back to raw for now).
- [ ] Register logclaw as a tool in `psclawmcp`.

## Notes

- npm name to confirm. Backup naming if taken: `logsclaw` / `clawlog`.
- ESM, `"type": "module"`, NodeNext resolution, relative imports use `.js`.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

## License

See [MIT](LICENSE)
