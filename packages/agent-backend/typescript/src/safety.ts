/**
 * Command safety validation (footgun checks).
 *
 * Checks commands against a small set of obvious-footgun patterns before
 * execution. This is a sanity check for catching hallucinated or miswired
 * commands; it is not a security boundary. Real isolation is provided by
 * Docker, bwrap, or a host-provided sandbox -- see opensdd/safety.md.
 */

/**
 * Configuration for safety checks
 */
export interface SafetyConfig {
  /**
   * Additional patterns that should be allowed even if they match blocked patterns.
   * These are checked before blocked patterns.
   */
  allowedPatterns?: RegExp[]
}

/**
 * Pattern descriptor for exporters.
 */
export interface DangerousPattern {
  pattern: RegExp
  reason: string
}

/**
 * Patterns that override the blocked list. The default list is empty; the
 * machinery remains so callers can extend via SafetyConfig.allowedPatterns.
 */
const DEFAULT_ALLOWED_PATTERNS: RegExp[] = []

/**
 * Blocked command patterns -- footgun protection only.
 * See opensdd/safety.md for the rationale behind what is and isn't here.
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  // System-wide destructive rm
  /\brm\b.*-rf?\b.*[/~*]/,
  /\brm\b.*[/~*].*-rf?\b/,

  // Disk wiping with dd
  /\bdd\b.*\bof=\/dev\//,

  // Pipe-to-shell (download-and-execute)
  /curl\b.*\|\s*(sh|bash|zsh|fish)\b/,
  /wget\b.*\|\s*(sh|bash|zsh|fish)\b/,
  /\|\s*(sh|bash|zsh|fish)\s*$/,

  // Fork bomb
  /:\(\)/,
]

/**
 * Check if a command matches any allowed pattern.
 */
function isAllowed(command: string, config?: SafetyConfig): boolean {
  const normalized = command.trim()
  const allAllowed = [...DEFAULT_ALLOWED_PATTERNS, ...(config?.allowedPatterns ?? [])]
  return allAllowed.some(pattern => pattern.test(normalized))
}

/**
 * Check if a command matches a blocked footgun pattern.
 */
export function isDangerous(command: string, config?: SafetyConfig): boolean {
  const normalized = command.trim().toLowerCase()

  if (isAllowed(command, config)) {
    return false
  }

  return DANGEROUS_PATTERNS.some(pattern => pattern.test(normalized))
}

/**
 * Extract the base command from a command string for logging/reporting.
 */
export function getBaseCommand(command: string): string {
  return command.trim().split(/\s+/)[0] || ''
}

/**
 * Check a command against the footgun pattern list.
 */
export function isCommandSafe(command: string, config?: SafetyConfig): { safe: boolean; reason?: string } {
  if (!isDangerous(command, config)) {
    return { safe: true, reason: '' }
  }

  if (/(?:curl|wget)\b.*\|\s*(?:sh|bash|zsh|fish)\b/.test(command.toLowerCase())) {
    return {
      safe: false,
      reason: "Piping downloads to shell is dangerous. Download to a file first (e.g., 'curl -O <url>'), inspect it, then execute if safe.",
    }
  }

  const baseCmd = getBaseCommand(command)
  return { safe: false, reason: `dangerous command '${baseCmd}' is not allowed` }
}

/**
 * Parsed structure of a command, surfaced for consumers that want a
 * quick breakdown without re-parsing.
 */
export interface ParsedCommand {
  command: string
  args: string[]
  hasAbsolutePath: boolean
}

export function parseCommand(command: string): ParsedCommand {
  const parts = command.trim().split(/\s+/)
  const baseCommand = parts[0] || ''
  const args = parts.slice(1)

  return {
    command: baseCommand,
    args,
    hasAbsolutePath: /(?<!https?:)(^|\s)\/[^\s]+/.test(command),
  }
}
