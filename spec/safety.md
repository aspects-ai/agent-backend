# Command Safety Specification

This document is the source of truth for command safety patterns. Both the [daemon spec](daemon.md) and [client spec](clients.md) reference this document for the complete list of blocked patterns.

When dangerous command blocking is enabled, commands MUST be checked against the patterns defined here before execution.

## Terminology

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are used as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

---

## Pre-processing

- Commands MUST be normalized to lowercase before pattern matching.
- Heredoc content MUST be stripped before safety validation to prevent false positives (heredocs contain literal data, not executable commands).
- Implementations MAY define allowed patterns that override specific blocked patterns. The default allowlist MUST include `gcloud rsync` (a gcloud subcommand, not the `rsync` binary).
- Allowed patterns MUST be checked before dangerous patterns; if a command matches an allowed pattern, it is not dangerous.

---

## Dangerous Command Patterns

The following regex patterns MUST be blocked. Each pattern uses `\b` for word boundaries where appropriate.

**Destructive operations:**
- `\brm\b.*-rf?\b.*[/~*]` and `\brm\b.*[/~*].*-rf?\b` -- system-wide destructive rm
- `\bdd\b.*\bof=\/dev\/` -- disk wiping with dd

**Privilege escalation:**
- `\bsudo\b`, `\bsu\b`

**System modification:**
- `\bchmod\b.*777`, `\bchown\b.*root`

**Pipe-to-shell (download-and-execute):**
- `curl\b.*\|\s*(sh|bash|zsh|fish)\b`
- `wget\b.*\|\s*(sh|bash|zsh|fish)\b`
- `\|\s*(sh|bash|zsh|fish)\s*$`

**Direct network tools:**
- `\bnc\b`, `\bncat\b`, `\bnetcat\b`, `\btelnet\b`, `\bftp\b`, `\bssh\b`, `\bscp\b`, `\brsync\b`

**Process and system control:**
- `\bkill\s+-9`, `\bkillall\b`, `\bpkill\b`
- `\bshutdown\b`, `\breboot\b`, `\bhalt\b`, `\binit\s+[06]\b`

**Filesystem manipulation:**
- `\bmount\b`, `\bumount\b`, `\bfdisk\b`, `\bmkfs\b`, `\bfsck\b`

**Command substitution:**
- `` `[^`]+` `` -- backtick substitution
- `\$\([^)]+\)` -- `$()` substitution

**Remote code execution:**
- `\beval\b`

**Resource exhaustion:**
- `:\(\)` -- fork bomb pattern
- `fork\(\)`
- `\bwhile\s+true\b`
- `\byes\b.*>\s*\/dev\/null`

**Network tampering:**
- `\biptables\b`
- `\bifconfig\b.*\bdown\b`

**System file modification:**
- `>>?\s*\/etc\/`, `>\s*\/etc\/`
- `\bcat\b.*>\s*\/etc\/`, `\becho\b.*>\s*\/etc\/`

**Obfuscation:**
- `[a-z]""[a-z]` -- string obfuscation (e.g., `r""m`)

**Path traversal in sensitive operations:**
- `\b(cp|mv|ln)\b.*\.\.\/`

**Symbolic link creation:**
- `\bln\s+-s`

---

## Workspace Escape Patterns

Implementations SHOULD also block commands that attempt to escape the workspace. The following patterns MUST be checked (after heredoc stripping):

- `\bcd\b`, `\bpushd\b`, `\bpopd\b` -- directory change commands
- `export\s+PATH=`, `export\s+HOME=`, `export\s+PWD=` -- environment manipulation
- `~\/` -- home directory reference
- `\$HOME`, `\$\{HOME\}` -- HOME variable references
- `\.\.[/\\]` -- parent directory traversal
- `` `[^`]+` ``, `\$\([^)]+\)` -- command substitution (may be used to escape)

---

## Safety Check Response

When a command is blocked, the response MUST include:
- A `safe: false` status.
- A `reason` string. Implementations SHOULD provide specific guidance for common cases (e.g., for pipe-to-shell: "Download to a file first, inspect it, then execute if safe").
