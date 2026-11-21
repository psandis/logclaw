# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-11-21

### Added

- User config file merged on top of the built-in defaults: `~/.config/logclaw/config.jsonc` (or `$XDG_CONFIG_HOME/logclaw/config.jsonc`) on macOS and Linux, `%APPDATA%\logclaw\config.jsonc` on Windows.
- `--config <path>` option and `LOGCLAW_CONFIG` environment variable for an extra config file.
- Merge rules: user `rawPatterns` and `timestamps.patterns` are tried first and replace built-in entries with the same name; field mappings, level aliases and continuation patterns are added to the defaults; other lists replace.
- `/* */` block comments in config files.
- `LOGCLAW_DEBUG=1` prints the loaded config files.
- macOS log formats in `rawPatterns`: unified log from `log show` / `log stream` (default, compact, and syslog styles), `/var/log/install.log`, `/var/log/wifi.log`, and daemon logs such as keybagd (`macos-daemon`) and usermanagerd (`macos-daemon-iso`). `log show --style ndjson` is read as JSON through new `eventMessage` and `messageType` field mappings.
- Generic catch-all `rawPatterns` at the end of the list (`generic-decorated-level`, `generic-uppercase-level`, `generic-timestamp`, `generic-bracket-time`) for formats without a dedicated entry: a timestamp at the start of the line, then an optional level such as `[info]`, `<Notice>`, `|Warning|` or `INFO -`.
- `rawPatterns` options: `levels` (level words for one pattern only, such as `{"E": "error"}`), `continuationPattern` (multi-line messages for one pattern), and `fallback` (generic entries that never make detection prefer raw parsing over JSON or logfmt).
- Timestamp formats `iso-offset`, `weekday-no-year`, and `time-only` (a time of day without a date uses today's date). Fractions may follow `.`, `,` or `:`; offsets may be `+HH`, `+HHMM`, `+HH:MM` or `Z`.
- `input.skipPatterns` drops header lines, such as the column headers printed by `log show`.
- `render.timeZone` (`source`, `utc`, `local`), `render.hideEmptyFields`, and `render.hideFields`.
- `raw` format: lines matched by `rawPatterns`. Accepted by `--format`.
- A warning on stderr when no format matches most lines.
- `tests/patterns.test.ts` checks every `rawPatterns` and `timestamps.patterns` `example`: it must match its own pattern, not be caught by an earlier one, and produce a valid timestamp and level.
- Level aliases `default` (info) and `fault` (fatal).

### Changed

- Everything that was hardcoded is now in `data/defaults.jsonc`: detection regexes and logfmt pair count, timestamp formats and month names, the seconds/milliseconds threshold, the level sniffing regex, stack-trace continuation patterns, level labels, missing-timestamp text, repeat badge and all render styles, the follow poll interval, and AI provider endpoints, API version, key and model environment variables, default models, limits and prompts.
- Raw patterns accept an optional `flags` field (default `i`).
- Render styles accept chained chalk styles such as `dim.italic` or `bgRed.white`.
- Invalid regexes and unreadable config files stop logclaw at startup with an error naming the pattern or file.
- OpenAI and Anthropic requests share one provider module instead of two copies.
- Detection leaves out stack-trace and other continuation lines when scoring formats.
- Detection prefers specific `rawPatterns` over logfmt when both fit, so a custom format that contains `key=value` pairs is not parsed as logfmt.
- Timestamps that carry a UTC offset are shown as written in the log by default (`render.timeZone: "source"`) instead of converted to UTC.

### Fixed

- Running logclaw in a terminal with no file and no piped input printed a blank line and exited with code 0. It now prints an error and the help text and exits with code 1.
- Empty input (an empty file or an empty pipe) printed a blank line. It now prints a warning to stderr.
- Errors reading stdin were silently treated as empty input. They are now reported.
- Piping a program that writes slowly, such as `log show | logclaw`, failed with `EAGAIN`. Stdin is now read as a stream until it ends.
- With `--no-group`, line numbers after a blank line were off by one or more. They now match the source line.
- `--ai-detect` with OpenAI now reads text from the response `output` array when `output_text` is absent, as `--summarize` already did.
- AI tests clear provider API keys before each test, so a real key in the shell can no longer cause a paid API call during `pnpm test`.

## [0.2.1] - 2026-11-21

### Changed

- Switched the development package manager from npm to pnpm. `package-lock.json` is replaced by `pnpm-lock.yaml`, and `pnpm-workspace.yaml` allows the `esbuild` build script. End users still install with `npm install -g logclaw`.
- Updated dependencies:
  - `chalk` 5.6.2 to 6.0.1
  - `commander` 12.1.0 to 15.1.0
  - `typescript` 5.9.3 to 7.0.2
  - `vitest` 2.1.9 to 5.1.1
  - `tsx` 4.22.3 to 4.23.15
  - `@types/node` 22.19.19 to 22.20.5 (kept on 22.x to match `engines.node >=22`)
- Passing more than one file argument now exits with `error: too many arguments` instead of silently ignoring the extra arguments (commander 15 behavior).
- README development instructions use pnpm.

### Added

- MIT `LICENSE` file.
- `CHANGELOG.md`.

## [0.2.0] - 2026-05-22

### Added

- `-f, --follow` live tail mode. Renders existing content, then new lines as they arrive, with stack-trace grouping and repeat collapsing carried across updates.
- Transparent gzip input for files and stdin, detected by `.gz` extension or gzip magic bytes.
- `--ai-detect` to infer a parsing pattern with OpenAI or Anthropic when auto-detection returns `unknown`. The pattern applies to the current session only.
- Tests for follow mode, gzip input, and AI format inference.

## [0.1.3] - 2026-05-21

### Fixed

- npm `bin` entries for `logclaw` and `lclaw` now point to wrapper scripts in `bin/`, and `bin` is included in the published package.

## [0.1.2] - 2026-05-21

### Added

- `repository`, `homepage`, and `bugs` metadata in `package.json`.

## [0.1.1] - 2026-05-21

### Changed

- README updates.

## [0.0.1] - 2026-05-21

### Added

- Automatic format detection for `json`, `logfmt`, `common` (Apache/nginx access), and `syslog`.
- Structured parsers for JSON and logfmt with configurable field mappings.
- Config-driven raw patterns for Apache/nginx access, Spring Boot, Laravel, Python logging, nginx error, Apache error, RFC3164 syslog, bracket-level ISO, and level-prefixed lines.
- Multiline grouping that folds Node, Java, and Python stack traces into a single entry.
- Collapsing of consecutive duplicate entries into `(×N)` badges.
- Colorized terminal rendering with timestamps, levels, and extra fields.
- Options: `--level`, `--format`, `--no-color`, `--no-group`, `--no-collapse`, `--no-trace`.
- `--summarize` and `--errors-only` for AI summaries through OpenAI or Anthropic, configured with `.env`.
- Defaults in `data/defaults.jsonc`.
- Sample log fixtures and a Vitest test suite.

[0.3.1]: https://github.com/psandis/logclaw/compare/9659781...HEAD
[0.2.1]: https://github.com/psandis/logclaw/compare/54b57fb...9659781
[0.2.0]: https://github.com/psandis/logclaw/compare/81e0564...2755b8e
[0.1.3]: https://github.com/psandis/logclaw/compare/99ee2b6...81e0564
[0.1.2]: https://github.com/psandis/logclaw/compare/532ebe9...99ee2b6
[0.1.1]: https://github.com/psandis/logclaw/compare/268788e...532ebe9
[0.0.1]: https://github.com/psandis/logclaw/commit/268788e
