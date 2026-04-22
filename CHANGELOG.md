# Changelog

All notable changes to AgentBackend will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The filesystem toolset is repositioned to target parity with Claude Code's
in-CLI file tools rather than the reference MCP Filesystem Server. See
`opensdd/daemon.md` for the updated contract.

### Added

- `grep` tool: content search backed by ripgrep. Registered for backends that
  support `exec` (i.e. not the memory backend). Parameters mirror Claude Code's
  Grep tool: `pattern`, `path`, `glob`, `type`, `outputMode`, `caseInsensitive`,
  `multiline`, `contextBefore`/`contextAfter`/`contextAround`, `lineNumbers`,
  `headLimit`. Requires `rg` on the host; the `agentbe-daemon` Docker image
  already includes it.
- `edit_file` edits now accept an optional `replaceAll` per-edit flag for bulk
  renames.
- `search_files` accepts an optional `sortBy: "path" | "mtime"` parameter.
  `mtime` sorts results newest-first, matching Claude Code's Glob behavior.

### Changed

- `read_text_file` now paginates by default (first 1,000 lines) and truncates
  lines longer than 2,000 chars. Use `offset` and `limit` to read further.
  Full-file reads without paging will see a trailing footer indicating more
  content is available. This is a minor-version breaking change for callers
  that relied on unparameterised full-file reads.
- `edit_file` now throws if an edit's `oldText` appears multiple times in the
  current file state and `replaceAll` is not set. Previously, only the first
  occurrence was silently replaced — which could edit the wrong instance. To
  preserve old behavior pass `replaceAll: true`, or add surrounding context to
  `oldText` to uniquely identify the intended match. Minor-version breaking.