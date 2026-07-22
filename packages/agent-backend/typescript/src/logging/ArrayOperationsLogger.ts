import type { LoggingMode, OperationLogEntry, OperationsLogger } from './types.js'

/**
 * In-memory array-based operations logger
 * Stores all logged operations in an array for later retrieval
 * Useful for testing, debugging, or building audit trails
 */
export class ArrayOperationsLogger implements OperationsLogger {
  private entries: OperationLogEntry[] = []

  constructor(public readonly mode: LoggingMode = 'standard') {}

  log(entry: OperationLogEntry): void {
    this.entries.push(entry)
  }

  /**
   * Get all logged entries
   * @returns Read-only array of log entries
   */
  getEntries(): ReadonlyArray<OperationLogEntry> {
    return this.entries
  }

  /**
   * Get entries filtered by operation type
   * @param operation - The operation type to filter by
   * @returns Array of matching log entries
   */
  getEntriesByOperation(operation: OperationLogEntry['operation']): ReadonlyArray<OperationLogEntry> {
    return this.entries.filter((entry) => entry.operation === operation)
  }

  /**
   * Get entries filtered by success status
   * @param success - Whether to get successful or failed operations
   * @returns Array of matching log entries
   */
  getEntriesByStatus(success: boolean): ReadonlyArray<OperationLogEntry> {
    return this.entries.filter((entry) => entry.success === success)
  }

  /**
   * Get the count of logged entries
   * @returns Number of entries
   */
  get length(): number {
    return this.entries.length
  }

  /**
   * Clear all logged entries
   */
  clear(): void {
    this.entries = []
  }

  /**
   * Get entries within a time range
   * @param start - Start timestamp
   * @param end - End timestamp
   * @returns Array of entries within the time range
   */
  getEntriesInRange(start: Date, end: Date): ReadonlyArray<OperationLogEntry> {
    return this.entries.filter(
      (entry) => entry.timestamp >= start && entry.timestamp <= end
    )
  }
}
