# Command Safety

> Behavioral contract for command sanity-check validation -- pre-processing rules, blocked-command patterns, and response format.

Both the [daemon spec](daemon.md) and [client spec](clients.md) reference this document for the complete list of blocked patterns. When `prevent_dangerous` is enabled, commands MUST be checked against the patterns defined here before execution.

---

## Scope

These checks are **sanity checks, not a security boundary**. They exist to catch obvious footguns (a hallucinated `rm -rf /`, a miswired `dd of=/dev/sda`) before they run. They do not attempt to sandbox the shell.

Real isolation is provided by:

- **Docker** (recommended default for non-dev use).
- **bwrap** (bubblewrap) isolation within `LocalFilesystemBackend` on Linux hosts that have it installed.
- The host itself, when the daemon runs inside an already-sandboxed environment (Kubernetes pod, VM, etc.).

Local mode without any of the above MUST emit a startup warning stating that it is unsandboxed and is intended for development use only.

Implementations MUST NOT treat the pattern list as a substitute for any of the above.

---

## Pre-processing

- Commands MUST be normalized to lowercase before pattern matching.
- Heredoc content MUST be stripped before validation to prevent false positives (heredocs contain literal data, not executable commands).
- Implementations MAY define allowed patterns via `SafetyConfig.allowed_patterns` to override specific blocked patterns.
- Allowed patterns MUST be checked before blocked patterns; if a command matches an allowed pattern, it is not blocked.

---

## Blocked Command Patterns

The following regex patterns MUST be blocked. Each pattern uses `\b` for word boundaries where appropriate.

**Destructive operations (footgun protection):**
- `\brm\b.*-rf?\b.*[/~*]` and `\brm\b.*[/~*].*-rf?\b` -- system-wide destructive rm
- `\bdd\b.*\bof=\/dev\/` -- disk wiping with dd

**Pipe-to-shell (download-and-execute footgun):**
- `curl\b.*\|\s*(sh|bash|zsh|fish)\b`
- `wget\b.*\|\s*(sh|bash|zsh|fish)\b`
- `\|\s*(sh|bash|zsh|fish)\s*$`

**Fork bombs (resource-exhaustion footgun):**
- `:\(\)` -- classic fork-bomb pattern

---

## Explicitly NOT Blocked

The following categories are **intentionally not blocked**, because regex-based blocking of them produces false positives without providing real protection. Real enforcement belongs to the sandbox or the host.

- Directory changes: `cd`, `pushd`, `popd`.
- Environment manipulation: `export PATH=`, `export HOME=`, etc.
- Home-directory references: `~/`, `$HOME`, `${HOME}`.
- Parent-directory traversal: `../`.
- Command substitution: `` `...` ``, `$(...)`.
- Privilege escalation: `sudo`, `su`, `doas` (host policy enforces these).
- Network tools: `nc`, `ssh`, `scp`, `rsync`, `ftp`, `telnet` (all legitimate dev tools).
- Process control: `kill`, `killall`, `pkill`.
- System control: `shutdown`, `reboot`, `halt`, `init`, `mount`, `umount`, `fdisk`, `mkfs`, `fsck`, `iptables`, `ifconfig` (all root-gated by the host).
- `chmod 777`, `chown root` (not inherently destructive).
- `eval`, `while true` (legitimate shell primitives).
- Writes to `/etc/` (root-gated by the host).
- Symlink creation (`ln -s`) and path-traversal in `cp`/`mv`/`ln` (legitimate).
- Obfuscation patterns (trivial to bypass; not a meaningful signal).

---

## Safety Check Response

When a command is blocked, the response MUST include:
- A `safe: false` status.
- A `reason` string. Implementations SHOULD provide specific guidance for common cases (e.g., for pipe-to-shell: "Download to a file first, inspect it, then execute if safe").
