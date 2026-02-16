import type { ConnectionStatus, StatusChangeCallback, StatusChangeEvent, Unsubscribe } from './types.js'

/**
 * Internal helper that encapsulates connection status state and listener management.
 * Used by all backend implementations. Not exported to consumers.
 */
export class ConnectionStatusManager {
  private _status: ConnectionStatus
  private listeners = new Set<StatusChangeCallback>()

  constructor(initialStatus: ConnectionStatus) {
    this._status = initialStatus
  }

  get status(): ConnectionStatus {
    return this._status
  }

  /**
   * Transition to a new status and notify listeners.
   * No-op if the new status is the same as the current status.
   */
  setStatus(newStatus: ConnectionStatus, error?: Error): void {
    if (this._status === newStatus) return

    const event: StatusChangeEvent = {
      from: this._status,
      to: newStatus,
      timestamp: Date.now(),
      error,
    }

    this._status = newStatus

    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Swallow listener errors to prevent cascading failures
      }
    }
  }

  /**
   * Subscribe to status changes. Returns an unsubscribe function.
   */
  onStatusChange(cb: StatusChangeCallback): Unsubscribe {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  /**
   * Remove all listeners. Called during destroy.
   */
  clearListeners(): void {
    this.listeners.clear()
  }
}
