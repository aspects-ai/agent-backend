import { randomUUID } from "node:crypto";

import type { RoomSession } from "./room-service.js";

/** Warm sessions idle longer than this are reaped. 15 minutes. */
export const DEFAULT_SESSION_IDLE_MS = 15 * 60_000;

export interface SessionRegistryOptions {
  /**
   * Release a session's sandbox after this many milliseconds with no activity.
   * `0` disables reaping.
   *
   * This is the **sole** owner of session lifetime. Sessions deliberately do not
   * die when an MCP connection closes: an agent work session runs for tens of
   * minutes, and a network blip or client restart must not destroy a live
   * sandbox and its uncommitted working tree.
   */
  idleMs?: number;
}

interface HeldSession {
  session: RoomSession;
  /** Who opened it. Only this principal may drive or close it. */
  principal: string;
  room: string;
  lastUsed: number;
  /** Tool calls currently running; never reap while > 0. */
  inFlight: number;
}

/**
 * Process-wide registry of warm sandbox sessions, keyed by an unguessable
 * server-generated id and authorized by principal.
 *
 * Scoped to `(principal, room)` rather than to a connection, so a client that
 * reconnects can re-attach to its live sandbox by id. The principal check is
 * what replaces connection scoping as the isolation boundary — note that under
 * a shared `authToken` every caller is `anonymous`, so that mode gives weaker
 * session isolation than per-principal tokens.
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, HeldSession>();
  private readonly idleMs: number;
  private reaper?: ReturnType<typeof setInterval>;

  constructor(options: SessionRegistryOptions = {}) {
    this.idleMs = options.idleMs ?? DEFAULT_SESSION_IDLE_MS;
    if (this.idleMs > 0) {
      const everyMs = Math.max(50, Math.min(this.idleMs / 2, 60_000));
      this.reaper = setInterval(() => this.sweep(), everyMs);
      // Don't hold the process open just to run the sweep.
      this.reaper.unref?.();
    }
  }

  open(room: string, principal: string, session: RoomSession): string {
    const id = randomUUID();
    this.sessions.set(id, { session, principal, room, lastUsed: Date.now(), inFlight: 0 });
    return id;
  }

  /**
   * Run `fn` against a session, keeping it alive for the duration. The in-flight
   * count is what stops the reaper pulling a sandbox out from under a command
   * that runs longer than the idle window.
   */
  async withSession<T>(
    id: string,
    principal: string,
    fn: (session: RoomSession) => Promise<T>,
  ): Promise<T> {
    const held = this.get(id, principal);
    held.inFlight++;
    try {
      return await fn(held.session);
    } finally {
      held.inFlight--;
      held.lastUsed = Date.now();
    }
  }

  async close(id: string, principal: string): Promise<void> {
    const held = this.sessions.get(id);
    if (!held) return;
    // Deliberately the same error as "unknown" — don't confirm a session id
    // exists to a principal that doesn't own it.
    if (held.principal !== principal) throw unknownSession(id);
    this.sessions.delete(id);
    await held.session.close();
  }

  /** Release everything — process shutdown only, never on connection close. */
  async closeAll(): Promise<void> {
    const held = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(held.map((h) => h.session.close().catch(() => undefined)));
  }

  stop(): void {
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = undefined;
  }

  /** Live session count — for tests and diagnostics. */
  get size(): number {
    return this.sessions.size;
  }

  private get(id: string, principal: string): HeldSession {
    const held = this.sessions.get(id);
    if (!held || held.principal !== principal) throw unknownSession(id);
    return held;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, held] of this.sessions) {
      if (held.inFlight === 0 && now - held.lastUsed >= this.idleMs) {
        this.sessions.delete(id);
        void held.session.close().catch(() => undefined);
      }
    }
  }
}

function unknownSession(id: string): Error {
  return new Error(`unknown or closed session: ${id}`);
}
