"""Command safety validation (footgun checks).

Checks commands against a small set of obvious-footgun patterns before
execution. This is a sanity check for catching hallucinated or miswired
commands; it is not a security boundary. Real isolation is provided by
Docker, bwrap, or a host-provided sandbox -- see opensdd/safety.md.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Patterns that override the blocked list. The default list is empty; the
# machinery remains so callers can extend via SafetyConfig.allowed_patterns.
DEFAULT_ALLOWED_PATTERNS: list[re.Pattern[str]] = []

# Blocked command patterns -- footgun protection only.
# See opensdd/safety.md for the rationale behind what is and isn't here.
DANGEROUS_PATTERNS: list[re.Pattern[str]] = [
    # System-wide destructive rm
    re.compile(r"\brm\b.*-rf?\b.*[/~*]"),
    re.compile(r"\brm\b.*[/~*].*-rf?\b"),
    # Disk wiping with dd
    re.compile(r"\bdd\b.*\bof=/dev/"),
    # Pipe-to-shell (download-and-execute)
    re.compile(r"curl\b.*\|\s*(sh|bash|zsh|fish)\b"),
    re.compile(r"wget\b.*\|\s*(sh|bash|zsh|fish)\b"),
    re.compile(r"\|\s*(sh|bash|zsh|fish)\s*$"),
    # Fork bomb
    re.compile(r":\(\)"),
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
    """Check if a command matches a blocked footgun pattern."""
    normalized = command.strip().lower()

    if _is_allowed(command, config):
        return False

    return any(pattern.search(normalized) for pattern in DANGEROUS_PATTERNS)


def get_base_command(command: str) -> str:
    """Extract the base command from a command string."""
    parts = command.strip().split()
    return parts[0] if parts else ""


def is_command_safe(command: str, config: SafetyConfig | None = None) -> SafetyResult:
    """Check a command against the footgun pattern list."""
    if not is_dangerous(command, config):
        return SafetyResult(safe=True)

    if re.search(r"(?:curl|wget)\b.*\|\s*(?:sh|bash|zsh|fish)\b", command.lower()):
        return SafetyResult(
            safe=False,
            reason=(
                "Piping downloads to shell is dangerous. Download to a file first "
                "(e.g., 'curl -O <url>'), inspect it, then execute if safe."
            ),
        )

    base_cmd = get_base_command(command)
    return SafetyResult(
        safe=False,
        reason=f"dangerous command '{base_cmd}' is not allowed",
    )
