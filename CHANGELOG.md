# Changelog

All notable changes to AgentBackend will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The filesystem toolset is repositioned to target parity with Claude Code's
in-CLI file tools rather than the reference MCP Filesystem Server. See
[packages/agent-backend/opensdd/daemon.md](packages/agent-backend/opensdd/daemon.md)
for the updated contract.

### Added

- **Agent document room** (`@agentbe/room`): a multiplayer, versioned,
  content-addressed document store with semantic + cross-modal (text/image)
  search and sandboxed command execution, exposed to agents over MCP
  (`search`, `read_document`, `run_command`, `open_session`/`write_file`/
  `commit_session`, `put_document`). See `docs/room-architecture.md` and
  `docs/room-deployment.md`.
- Per-principal commit attribution derived from the transport credential
  (never a caller-suppliable argument), with per-person bearer tokens via
  `AGENTBE_PRINCIPALS`.
- Docker and Kubernetes sandbox providers (`AGENTBE_SANDBOX=docker|k8s|agent-sandbox`),
  giving each session its own container or pod; `k8s` needs no extra install,
  `agent-sandbox` adds a warm pool for lower session start latency.
- S3-backed canonical store and a persistent pgvector-backed search index for
  production deployments.
- `grep` tool: content search backed by ripgrep. Registered for backends that
  support `exec` (i.e. not the memory backend). Parameters mirror Claude Code's
  Grep tool: `pattern`, `path`, `glob`, `type`, `outputMode`, `caseInsensitive`,
  `multiline`, `contextBefore`/`contextAfter`/`contextAround`, `lineNumbers`,
  `headLimit`. The three context parameters may be combined freely and resolve
  the way `rg` itself resolves them — an explicit `contextBefore`/`contextAfter`
  wins over `contextAround` for that side — and are ignored outside
  `outputMode: "content"` rather than rejected. Requires `rg` on the host; the
  `agentbe-daemon` Docker image already includes it.
- `edit_file` edits now accept an optional `replaceAll` per-edit flag for bulk
  renames.
- `search_files` accepts an optional `sortBy: "path" | "mtime"` parameter.
  `mtime` sorts results newest-first, matching Claude Code's Glob behavior.

### Fixed

- `edit_file` could hang the daemon indefinitely at 100% CPU. Its hand-rolled
  unified-diff renderer advanced its two cursors only inside a pair of 10-line
  lookahead scans, and when both scans declined to advance — which any adjacent
  transposition satisfies, and which repeated boilerplate lines in structured
  text trigger readily — the loop re-ran identically forever. Because rendering
  is synchronous, this blocked the daemon's only thread: every session it served
  went unresponsive, and the process stayed pinned after the caller
  disconnected. Diff rendering now delegates to the `diff` library, which
  terminates for all inputs and also fixes silently wrong hunks on larger
  reorderings.

### Changed

- `edit_file` diffs now carry standard `@@` hunk headers with 3 lines of
  context, and rendering is bounded by a budget enforced inside the diff loop
  (15 s wall clock, 20,000 line-level edits). On breach the tool returns the
  file headers plus a `[diff omitted: ...]` marker instead of blocking. The
  write is now performed before the diff is rendered, so a degraded or failed
  render can never discard an edit that has already been applied; in that case
  the result leads with a line confirming the edit landed.
- `read_text_file` now paginates by default (first 1,000 lines) and truncates
  lines longer than 2,000 chars. Use `offset` and `limit` to read further.
  Full-file reads without paging will see a trailing footer indicating more
  content is available. This is a minor-version breaking change for callers
  that relied on unparameterised full-file reads.
- `read_text_file` paging is now a single mode: `offset`/`limit`. The `head` and
  `tail` parameters are removed, and with only one mode left there is no
  mode-conflict error to throw. `head: N` was byte-identical to
  `offset: 1, limit: N`; `tail` is reachable via `exec` (`tail -n 100 <file>`).
  The `offset`/`limit` descriptions now say to supply them only if the file is
  too large to read at once, and no longer advertise the clamp ceiling.
  Rationale: the four-parameter surface encoded three mutually-exclusive modes,
  and models routinely filled every field and got an error on a read the tool
  had enough information to serve. Minor-version breaking for callers whose
  prompts explicitly instruct agents to use `head`/`tail`.
- `edit_file` now throws if an edit's `oldText` appears multiple times in the
  current file state and `replaceAll` is not set. Previously, only the first
  occurrence was silently replaced — which could edit the wrong instance. To
  preserve old behavior pass `replaceAll: true`, or add surrounding context to
  `oldText` to uniquely identify the intended match. Minor-version breaking.