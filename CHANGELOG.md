# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.1]: https://github.com/psandis/logclaw/compare/54b57fb...HEAD
[0.2.0]: https://github.com/psandis/logclaw/compare/81e0564...2755b8e
[0.1.3]: https://github.com/psandis/logclaw/compare/99ee2b6...81e0564
[0.1.2]: https://github.com/psandis/logclaw/compare/532ebe9...99ee2b6
[0.1.1]: https://github.com/psandis/logclaw/compare/268788e...532ebe9
[0.0.1]: https://github.com/psandis/logclaw/commit/268788e
