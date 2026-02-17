/**
 * Configuration for safety checks
 */
export interface SafetyConfig {
  /**
   * Additional patterns that should be allowed even if they match dangerous patterns.
   * These are checked before dangerous patterns.
   */
  allowedPatterns?: RegExp[]
}

/**
 * Default patterns that are allowed even though they might match dangerous patterns.
 * These represent safe variations of otherwise dangerous commands.
 */
const DEFAULT_ALLOWED_PATTERNS: RegExp[] = [
  // gcloud rsync is a gcloud subcommand, not the rsync binary - it's safe
  /^gcloud\s+.*\brsync\b/,
  /^gcloud\s+storage\s+rsync\b/,
]

/**
 * List of command patterns that are considered dangerous
 * These patterns will be blocked when preventDangerous is true
 */
const DANGEROUS_PATTERNS = [
  // System-wide destructive rm operations
  /\brm\b.*-rf?\b.*[/~*]/,  // rm with -r or -rf flag and dangerous paths
  /\brm\b.*[/~*].*-rf?\b/,  // rm with dangerous paths then -r or -rf

  // Disk wiping with dd
  /\bdd\b.*\bof=\/dev\//,

  // Privilege escalation
  /\bsudo\b/,
  /\bsu\b/,

  // System modification
  /\bchmod\b.*777/,
  /\bchown\b.*root/,

  // Dangerous network downloads and execution (pipe-to-shell)
  /curl\b.*\|\s*(sh|bash|zsh|fish)\b/,
  /wget\b.*\|\s*(sh|bash|zsh|fish)\b/,
  /\|\s*(sh|bash|zsh|fish)\s*$/,

  // Direct network tools that are inherently dangerous
  /\bnc\b/,
  /\bncat\b/,
  /\bnetcat\b/,
  /\btelnet\b/,
  /\bftp\b/,
  /\bssh\b/,
  /\bscp\b/,
  /\brsync\b/,

  // Process/system control
  /\bkill\s+-9/,
  /\bkillall\b/,
  /\bpkill\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bhalt\b/,
  /\binit\s+[06]\b/,

  // File system manipulation outside workspace context
  /\bmount\b/,
  /\bumount\b/,
  /\bfdisk\b/,
  /\bmkfs\b/,
  /\bfsck\b/,

  // Command substitution (inherently dangerous - allows code execution)
  /`[^`]+`/,  // Backtick command substitution
  /\$\([^)]+\)/,  // $() command substitution

  // Remote code execution
  /\beval\b/,

  // Fork bombs and resource exhaustion
  /:\(\)/,  // :() pattern for fork bombs
  /fork\(\)/,  // fork() pattern
  /\bwhile\s+true\b/,
  /\byes\b.*>\s*\/dev\/null/,

  // Network tampering
  /\biptables\b/,
  /\bifconfig\b.*\bdown\b/,

  // System file modification
  />>?\s*\/etc\//,
  />\s*\/etc\//,
  /\bcat\b.*>\s*\/etc\//,
  /\becho\b.*>\s*\/etc\//,

  // Obfuscation patterns
  /[a-z]""[a-z]/,  // r""m style obfuscation

  // Path traversal attempts in sensitive operations
  /\b(cp|mv|ln)\b.*\.\.\//,

  // Symbolic link creation that could escape
  /\bln\s+-s/,
]

/**
 * Additional patterns for commands that try to escape workspace
 */
const ESCAPE_PATTERNS = [
  // Change directory commands
  /\bcd\b/,
  /\bpushd\b/,
  /\bpopd\b/,
  
  // Environment manipulation that could affect paths
  /export\s+PATH=/,
  /export\s+HOME=/,
  /export\s+PWD=/,
  
  // Absolute paths (except when checking for URLs)
  // /(?<!https?:)(^|\s)\/[^\s]+/,  // Match absolute paths at word boundaries, not inside quotes
  
  // Shell expansion
  /~\//,         // Home directory
  /\$HOME/,      // HOME variable
  /\$\{HOME\}/,  // HOME variable with braces
  
  // Parent directory traversal
  /\.\.[/\\]/,
  
  // Command substitution (could be used to escape)
  /\$\([^)]+\)/,  // $() command substitution
  /`[^`]+`/,      // Backtick command substitution
]

/**
 * Check if a command matches any allowed pattern
 * @param command - The command to check
 * @param config - Optional safety configuration with additional allowed patterns
 * @returns true if the command matches an allowed pattern
 */
function isAllowed(command: string, config?: SafetyConfig): boolean {
  const normalized = command.trim()
  const allAllowed = [...DEFAULT_ALLOWED_PATTERNS, ...(config?.allowedPatterns ?? [])]

  return allAllowed.some(pattern => pattern.test(normalized))
}

/**
 * Check if a command contains dangerous operations
 * @param command - The command to check
 * @param config - Optional safety configuration with allowed pattern exceptions
 * @returns true if the command is considered dangerous
 */
export function isDangerous(command: string, config?: SafetyConfig): boolean {
  const normalized = command.trim().toLowerCase()

  // Check allowlist first - if matched, it's not dangerous
  if (isAllowed(command, config)) {
    return false
  }

  return DANGEROUS_PATTERNS.some(pattern => pattern.test(normalized))
}

/**
 * Extract heredoc markers and their content from a command
 * Heredocs with single quotes (<<'EOF') don't perform shell expansion, so their content is safe
 * @param command - The command to check
 * @returns Command with heredoc content replaced by placeholders
 */
function stripHeredocContent(command: string): string {
  // Match heredocs: << 'DELIMITER' ... DELIMITER or << "DELIMITER" ... DELIMITER or <<DELIMITER ... DELIMITER
  // We'll be conservative and strip all heredoc content since it's literal data
  const heredocRegex = /<<\s*['"]?(\w+)['"]?[\s\S]*?\n\1/g

  // Replace heredoc content with a safe placeholder
  return command.replace(heredocRegex, '<<HEREDOC_PLACEHOLDER')
}

/**
 * Check if a command attempts to escape the workspace
 * @param command - The command to check
 * @returns true if the command attempts to access outside workspace
 */
export function isEscapingWorkspace(command: string): boolean {
  // Strip heredoc content before validation since heredocs are literal data
  const commandWithoutHeredocs = stripHeredocContent(command)

  return ESCAPE_PATTERNS.some(pattern => pattern.test(commandWithoutHeredocs))
}

/**
 * Extract the base command from a command string for logging/reporting
 * @param command - The full command string
 * @returns The base command (first word)
 */
export function getBaseCommand(command: string): string {
  return command.trim().split(/\s+/)[0] || ''
}

/**
 * Comprehensive safety check for commands
 * Combines dangerous command checking and workspace escape detection
 * @param command - The command to check
 * @param config - Optional safety configuration with allowed pattern exceptions
 * @returns Object with safety status and optional reason
 */
export function isCommandSafe(command: string, config?: SafetyConfig): { safe: boolean; reason?: string } {
  // Check for dangerous commands first
  if (isDangerous(command, config)) {
    const baseCmd = getBaseCommand(command)

    // Provide specific guidance for pipe-to-shell attempts
    if (/(?:curl|wget)\b.*\|\s*(?:sh|bash|zsh|fish)\b/.test(command.toLowerCase())) {
      return {
        safe: false,
        reason: "Piping downloads to shell is dangerous. Download to a file first (e.g., 'curl -O <url>'), inspect it, then execute if safe."
      }
    }

    return { safe: false, reason: `dangerous command '${baseCmd}' is not allowed` }
  }

  // Check for workspace escape attempts
  if (isEscapingWorkspace(command)) {
    // More specific messages for different escape types
    if (/\bcd\b/.test(command)) {
      return { safe: false, reason: 'Directory change commands are not allowed' }
    }
    // if (/(?<!https?:)(^|\s)\/[^\s]+/.test(command)) {
    //   return { safe: false, reason: 'Command contains absolute paths' }
    // }
    if (/~\//.test(command) || /\$HOME/.test(command)) {
      return { safe: false, reason: 'Home directory references are not allowed' }
    }
    if (/\.\.[/\\]/.test(command)) {
      return { safe: false, reason: 'Parent directory traversal is not allowed' }
    }
    return { safe: false, reason: 'Command attempts to escape workspace' }
  }

  return { safe: true, reason: '' }
}

/**
 * Parse a command to extract basic structure
 * @param command - The command to parse
 * @returns Parsed command info
 */
export interface ParsedCommand {
  command: string
  args: string[]
  hasAbsolutePath: boolean
  hasEscapePattern: boolean
}

export function parseCommand(command: string): ParsedCommand {
  const parts = command.trim().split(/\s+/)
  const baseCommand = parts[0] || ''
  const args = parts.slice(1)
  
  return {
    command: baseCommand,
    args,
    hasAbsolutePath: /(?<!https?:)(^|\s)\/[^\s]+/.test(command),
    hasEscapePattern: isEscapingWorkspace(command),
  }
}
