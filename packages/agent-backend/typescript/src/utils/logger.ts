/**
 * Simple internal logger for AgentBackend
 * Provides controlled logging that can be easily disabled or redirected
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export interface Logger {
  error(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
}

/**
 * Default logger implementation that writes to console
 * Can be replaced with custom implementation via setLogger
 */
class DefaultLogger implements Logger {
  constructor(private enabled = true) {}

  private get debugEnabled(): boolean {
    return this.enabled && process.env.AGENTBE_DEBUG_LOGGING === 'true'
  }

  error(message: string, ...args: unknown[]): void {
    if (this.enabled) {
       
      console.error(`[AgentBackend] ${message}`, ...args)
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.enabled) {
       
      console.warn(`[AgentBackend] ${message}`, ...args)
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.enabled) {
       
      console.info(`[AgentBackend] ${message}`, ...args)
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.debugEnabled) {
       
      console.debug(`[AgentBackend] ${message}`, ...args)
    }
  }
}

let currentLogger: Logger = new DefaultLogger(true)

/**
 * Set a custom logger implementation
 * @param logger - Logger instance to use
 */
export function setLogger(logger: Logger): void {
  currentLogger = logger
}

/**
 * Get the current logger instance
 * @returns Current logger
 */
export function getLogger(): Logger {
  return currentLogger
}
