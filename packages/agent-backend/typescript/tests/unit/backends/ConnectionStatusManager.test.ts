import { describe, it, expect, vi } from 'vitest'
import { ConnectionStatusManager } from '../../../src/backends/ConnectionStatusManager.js'
import { ConnectionStatus } from '../../../src/backends/types.js'

describe('ConnectionStatusManager', () => {
  describe('Initial Status', () => {
    it('should start with the initial status provided', () => {
      const mgr = new ConnectionStatusManager(ConnectionStatus.CONNECTED)
      expect(mgr.status).toBe(ConnectionStatus.CONNECTED)
    })

    it('should start with DISCONNECTED when specified', () => {
      const mgr = new ConnectionStatusManager(ConnectionStatus.DISCONNECTED)
      expect(mgr.status).toBe(ConnectionStatus.DISCONNECTED)
    })
  })

  describe('Status Transitions', () => {
    it('should transition to a new status', () => {
      const mgr = new ConnectionStatusManager(ConnectionStatus.DISCONNECTED)

      mgr.setStatus(ConnectionStatus.CONNECTING)
      expect(mgr.status).toBe(ConnectionStatus.CONNECTING)

      mgr.setStatus(ConnectionStatus.CONNECTED)
      expect(mgr.status).toBe(ConnectionStatus.CONNECTED)
    })

    it('should no-op when setting same status', () => {
      const mgr = new ConnectionStatusManager(ConnectionStatus.CONNECTED)
      const listener = vi.fn()
      mgr.onStatusChange(listener)

      mgr.setStatus(ConnectionStatus.CONNECTED)

      expect(listener).not.toHaveBeenCalled()
      expect(mgr.status).toBe(ConnectionStatus.CONNECTED)
    })

    it('should transition through full lifecycle', () => {
      const mgr = new ConnectionStatusManager(ConnectionStatus.DISCONNECTED)

      mgr.setStatus(ConnectionStatus.CONNECTING)
      expect(mgr.status).toBe(ConnectionStatus.CONNECTING)

      mgr.setStatus(ConnectionStatus.CONNECTED)
      expect(mgr.status).toBe(ConnectionStatus.CONNECTED)

      mgr.setStatus(ConnectionStatus.DISCONNECTED)
      expect(mgr.status).toBe(ConnectionStatus.DISCONNECTED)

      mgr.setStatus(ConnectionStatus.RECONNECTING)
      expect(mgr.status).toBe(ConnectionStatus.RECONNECTING)

      mgr.setStatus(ConnectionStatus.CONNECTED)
      expect(mgr.status).toBe(ConnectionStatus.CONNECTED)

      mgr.setStatus(ConnectionStatus.DESTROYED)
      expect(mgr.status).toBe(ConnectionStatus.DESTROYED)
    })
  })

  describe('Listener Notification', () => {
    it('should notify listeners on status change', () => {
      const mgr = new ConnectionStatusManager(ConnectionStatus.DISCONNECTED)
      const listener = vi.fn()
      mgr.onStatusChange(listener)

      mgr.setStatus(ConnectionStatus.CONNECTING)

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith({
        from: ConnectionStatus.DISCONNECTED,
        to: ConnectionStatus.CONNECTING,
        timestamp: expect.any(Number),
      })
    })

    it('should include error in event when provided', () => {
      const mgr = new ConnectionStatusManager(ConnectionStatus.CONNECTED)
      const listener = vi.fn()
      mgr.onStatusChange(listener)

      const error = new Error('Connection lost')
      mgr.setStatus(ConnectionStatus.DISCONNECTED, error)

      expect(listener).toHaveBeenCalledWith({
        from: ConnectionStatus.CONNECTED,
        to: ConnectionStatus.DISCONNECTED,
        timestamp: expect.any(Number),
        error,
      })
    })

    it('should notify multiple listeners', () => {
      const mgr = new ConnectionStatusManager(ConnectionStatus.DISCONNECTED)
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      mgr.onStatusChange(listener1)
      mgr.onStatusChange(listener2)

      mgr.setStatus(ConnectionStatus.CONNECTING)

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
    })

    it('should not notify after unsubscribe', () => {
      const mgr = new ConnectionStatusManager(ConnectionStatus.DISCONNECTED)
      const listener = vi.fn()

      const unsubscribe = mgr.onStatusChange(listener)
      unsubscribe()

      mgr.setStatus(ConnectionStatus.CONNECTING)

      expect(listener).not.toHaveBeenCalled()
    })

    it('should only unsubscribe the specific listener', () => {
      const mgr = new ConnectionStatusManager(ConnectionStatus.DISCONNECTED)
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      const unsub1 = mgr.onStatusChange(listener1)
      mgr.onStatusChange(listener2)

      unsub1()
      mgr.setStatus(ConnectionStatus.CONNECTING)

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).toHaveBeenCalledTimes(1)
    })

    it('should swallow listener errors without affecting other listeners', () => {
      const mgr = new ConnectionStatusManager(ConnectionStatus.DISCONNECTED)
      const errorListener = vi.fn(() => { throw new Error('listener error') })
      const goodListener = vi.fn()

      mgr.onStatusChange(errorListener)
      mgr.onStatusChange(goodListener)

      mgr.setStatus(ConnectionStatus.CONNECTING)

      expect(errorListener).toHaveBeenCalledTimes(1)
      expect(goodListener).toHaveBeenCalledTimes(1)
    })
  })

  describe('clearListeners', () => {
    it('should remove all listeners', () => {
      const mgr = new ConnectionStatusManager(ConnectionStatus.CONNECTED)
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      mgr.onStatusChange(listener1)
      mgr.onStatusChange(listener2)

      mgr.clearListeners()
      mgr.setStatus(ConnectionStatus.DESTROYED)

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).not.toHaveBeenCalled()
    })
  })

  describe('Timestamp', () => {
    it('should include a valid timestamp in events', () => {
      const mgr = new ConnectionStatusManager(ConnectionStatus.DISCONNECTED)
      const listener = vi.fn()
      mgr.onStatusChange(listener)

      const before = Date.now()
      mgr.setStatus(ConnectionStatus.CONNECTING)
      const after = Date.now()

      const event = listener.mock.calls[0][0]
      expect(event.timestamp).toBeGreaterThanOrEqual(before)
      expect(event.timestamp).toBeLessThanOrEqual(after)
    })
  })
})
