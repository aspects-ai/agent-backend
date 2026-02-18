"""Command safety validation (blocked patterns).

Checks commands against known dangerous patterns before execution.
Implements heredoc stripping and allowed pattern overrides.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Default patterns that are allowed even though they might match dangerous patterns
DEFAULT_ALLOWED_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"^gcloud\s+.*\brsync\b"),
    re.compile(r"^gcloud\s+storage\s+rsync\b"),
]

# Dangerous command patterns
DANGEROUS_PATTERNS: list[re.Pattern[str]] = [
    # System-wide destructive rm operations
    re.compile(r"\brm\b.*-rf?\b.*[/~*]"),
    re.compile(r"\brm\b.*[/~*].*-rf?\b"),
    # Disk wiping with dd
    re.compile(r"\bdd\b.*\bof=/dev/"),
    # Privilege escalation
    re.compile(r"\bsudo\b"),
    re.compile(r"\bsu\b"),
    re.compile(r"\bdoas\b"),
    # System modification
    re.compile(r"\bchmod\b.*777"),
    re.compile(r"\bchown\b.*root"),
    # Dangerous network downloads and execution (pipe-to-shell)
    re.compile(r"curl\b.*\|\s*(sh|bash|zsh|fish)\b"),
    re.compile(r"wget\b.*\|\s*(sh|bash|zsh|fish)\b"),
    re.compile(r"\|\s*(sh|bash|zsh|fish)\s*$"),
    # Direct network tools
    re.compile(r"\bnc\b"),
    re.compile(r"\bncat\b"),
    re.compile(r"\bnetcat\b"),
    re.compile(r"\btelnet\b"),
    re.compile(r"\bftp\b"),
    re.compile(r"\bssh\b"),
    re.compile(r"\bscp\b"),
    re.compile(r"\brsync\b"),
    # Process/system control
    re.compile(r"\bkill\s+-9"),
    re.compile(r"\bkillall\b"),
    re.compile(r"\bpkill\b"),
    re.compile(r"\bshutdown\b"),
    re.compile(r"\breboot\b"),
    re.compile(r"\bhalt\b"),
    re.compile(r"\binit\s+[06]\b"),
    # File system manipulation
    re.compile(r"\bmount\b"),
    re.compile(r"\bumount\b"),
    re.compile(r"\bfdisk\b"),
    re.compile(r"\bmkfs\b"),
    re.compile(r"\bfsck\b"),
    # Command substitution
    re.compile(r"`[^`]+`"),
    re.compile(r"\$\([^)]+\)"),
    # Remote code execution
    re.compile(r"\beval\b"),
    # Fork bombs and resource exhaustion
    re.compile(r":\(\)"),
    re.compile(r"fork\(\)"),
    re.compile(r"\bwhile\s+true\b"),
    re.compile(r"\byes\b.*>\s*/dev/null"),
    # Network tampering
    re.compile(r"\biptables\b"),
    re.compile(r"\bifconfig\b"),
    # System file modification
    re.compile(r">>?\s*/etc/"),
    re.compile(r">\s*/etc/"),
    re.compile(r"\bcat\b.*>\s*/etc/"),
    re.compile(r"\becho\b.*>\s*/etc/"),
    # Obfuscation patterns
    re.compile(r'[a-z]""[a-z]'),
    # Path traversal in sensitive operations
    re.compile(r"\b(cp|mv|ln)\b.*\.\./"),
    # Symbolic link creation that could escape
    re.compile(r"\bln\s+-s"),
]

# Patterns for workspace escape attempts
ESCAPE_PATTERNS: list[re.Pattern[str]] = [
    # Change directory commands
    re.compile(r"\bcd\b"),
    re.compile(r"\bpushd\b"),
    re.compile(r"\bpopd\b"),
    # Environment manipulation
    re.compile(r"export\s+PATH="),
    re.compile(r"export\s+HOME="),
    re.compile(r"export\s+PWD="),
    # Home directory
    re.compile(r"~/"),
    re.compile(r"\$HOME"),
    re.compile(r"\$\{HOME\}"),
    # Parent directory traversal
    re.compile(r"\.\.[/\\]"),
    # Command substitution
    re.compile(r"\$\([^)]+\)"),
    re.compile(r"`[^`]+`"),
]


@dataclass
class SafetyConfig:
    """Configuration for safety checks."""

    allowed_patterns: list[re.Pattern[str]] = field(default_factory=list)


@dataclass
class SafetyResult:
    """Result of a safety check."""

    safe: bool
    reason: str = ""


def _is_allowed(command: str, config: SafetyConfig | None = None) -> bool:
    """Check if a command matches any allowed pattern."""
    normalized = command.strip()
    all_allowed = DEFAULT_ALLOWED_PATTERNS + (config.allowed_patterns if config else [])
    return any(pattern.search(normalized) for pattern in all_allowed)


def is_dangerous(command: str, config: SafetyConfig | None = None) -> bool:
    """Check if a command contains dangerous operations."""
    normalized = command.strip().lower()

    if _is_allowed(command, config):
        return False

    return any(pattern.search(normalized) for pattern in DANGEROUS_PATTERNS)


def _strip_heredoc_content(command: str) -> str:
    """Strip heredoc content from command to prevent false positives."""
    heredoc_regex = re.compile(r"<<\s*['\"]?(\w+)['\"]?[\s\S]*?\n\1", re.MULTILINE)
    return heredoc_regex.sub("<<HEREDOC_PLACEHOLDER", command)


def is_escaping_workspace(command: str) -> bool:
    """Check if a command attempts to escape the workspace."""
    command_without_heredocs = _strip_heredoc_content(command)
    return any(pattern.search(command_without_heredocs) for pattern in ESCAPE_PATTERNS)


def get_base_command(command: str) -> str:
    """Extract the base command from a command string."""
    parts = command.strip().split()
    return parts[0] if parts else ""


def is_command_safe(command: str, config: SafetyConfig | None = None) -> SafetyResult:
    """Comprehensive safety check for commands.

    Combines dangerous command checking and workspace escape detection.
    """
    if is_dangerous(command, config):
        base_cmd = get_base_command(command)

        # Specific guidance for pipe-to-shell
        if re.search(
            r"(?:curl|wget)\b.*\|\s*(?:sh|bash|zsh|fish)\b", command.lower()
        ):
            return SafetyResult(
                safe=False,
                reason=(
                    "Piping downloads to shell is dangerous. Download to a file first "
                    "(e.g., 'curl -O <url>'), inspect it, then execute if safe."
                ),
            )

        return SafetyResult(
            safe=False,
            reason=f"dangerous command '{base_cmd}' is not allowed",
        )

    if is_escaping_workspace(command):
        if re.search(r"\bcd\b", command):
            return SafetyResult(
                safe=False, reason="Directory change commands are not allowed"
            )
        if re.search(r"~/", command) or re.search(r"\$HOME", command):
            return SafetyResult(
                safe=False, reason="Home directory references are not allowed"
            )
        if re.search(r"\.\.[/\\]", command):
            return SafetyResult(
                safe=False, reason="Parent directory traversal is not allowed"
            )
        return SafetyResult(
            safe=False, reason="Command attempts to escape workspace"
        )

    return SafetyResult(safe=True)
