import { BrowserWindow, type WebContents } from 'electron'
import { randomUUID } from 'crypto'

/**
 * WindowManager — central registry for all BrowserWindows and per-connection
 * subscriptions.
 *
 * Why this exists:
 *
 * Before WindowManager, IPC event delivery used two patterns:
 *   1. `BrowserWindow.fromWebContents(event.sender)` — events flow only to the
 *      window that initiated the IPC. Works for single-window, breaks the
 *      moment a second window wants to observe the same connection.
 *   2. `BrowserWindow.getAllWindows()` — broadcasts to every window. Fine for
 *      logs but wastes cycles and leaks state for connection-scoped events.
 *
 * WindowManager introduces a subscription model: a window explicitly calls
 * `subscribe(windowId, connectionId)` when it starts displaying a connection,
 * and `unsubscribe(...)` when it stops. Events for that connection only go to
 * subscribers. When the last subscriber unsubscribes (or the last subscribed
 * window closes), the connection is reported as "orphaned" so callers can
 * shut down the underlying service resource.
 *
 * This enables:
 *   - Multiple windows watching the same SSH/SQL/monitor connection
 *   - Refcounted cleanup (connection closes only when no window cares anymore)
 *   - Drop-in replacement for the two legacy patterns above
 */

export type StandaloneMode = 'sql' | 'terminal' | 'monitor' | 'sftp'

export interface WindowRecord {
  /** Stable ID assigned on registration; unique per window lifetime */
  id: string
  browserWindow: BrowserWindow
  kind: 'main' | 'standalone'
  /** Only set for standalone windows */
  mode?: StandaloneMode
  createdAt: number
}

type EventName = 'connections-orphaned' | 'window-closed' | 'window-registered'
type Listener = (...args: unknown[]) => void

export class WindowManager {
  private windows = new Map<string, WindowRecord>()
  private subscriptions = new Map<string, Set<string>>() // connectionId → Set<windowId>
  private listeners = new Map<EventName, Set<Listener>>()

  // ── Registration ──

  /**
   * Register a BrowserWindow with the manager. Returns a stable windowId
   * that the renderer can be told via URL param, or looked up later via
   * `getWindowIdForWebContents`.
   *
   * The manager automatically listens to the `closed` event and cleans up
   * subscriptions — no manual teardown needed.
   */
  register(
    browserWindow: BrowserWindow,
    kind: 'main' | 'standalone',
    mode?: StandaloneMode,
  ): string {
    const id = randomUUID()
    const record: WindowRecord = {
      id,
      browserWindow,
      kind,
      mode,
      createdAt: Date.now(),
    }
    this.windows.set(id, record)

    browserWindow.once('closed', () => this.onWindowClosed(id))

    this.emit('window-registered', record)
    return id
  }

  getWindow(windowId: string): BrowserWindow | undefined {
    return this.windows.get(windowId)?.browserWindow
  }

  getRecord(windowId: string): WindowRecord | undefined {
    return this.windows.get(windowId)
  }

  /**
   * Look up the windowId for a given WebContents (the `event.sender` of an IPC
   * handler). Returns `undefined` if the sender is not one of ours (e.g. a
   * devtools window).
   */
  getWindowIdForWebContents(webContents: WebContents): string | undefined {
    for (const [id, record] of this.windows) {
      if (record.browserWindow.webContents === webContents) {
        return id
      }
    }
    return undefined
  }

  getMainWindow(): BrowserWindow | undefined {
    for (const record of this.windows.values()) {
      if (record.kind === 'main') return record.browserWindow
    }
    return undefined
  }

  listStandaloneWindows(): WindowRecord[] {
    const out: WindowRecord[] = []
    for (const record of this.windows.values()) {
      if (record.kind === 'standalone') out.push(record)
    }
    return out
  }

  /** Returns true if any live window is a standalone of the given mode for sessionId. */
  findStandaloneFor(mode: StandaloneMode, sessionId: string): BrowserWindow | undefined {
    for (const record of this.windows.values()) {
      if (
        record.kind === 'standalone' &&
        record.mode === mode &&
        !record.browserWindow.isDestroyed()
      ) {
        // Inspect the URL for sessionId — the standalone URL is built with that param
        try {
          const url = record.browserWindow.webContents.getURL()
          const search = url.includes('?') ? url.slice(url.indexOf('?')) : ''
          const params = new URLSearchParams(search)
          if (params.get('sessionId') === sessionId) {
            return record.browserWindow
          }
        } catch {
          /* ignore */
        }
      }
    }
    return undefined
  }

  // ── Subscriptions ──

  /**
   * Subscribe a window to a connection's event stream. Safe to call multiple
   * times — duplicate subscriptions are idempotent.
   */
  subscribe(windowId: string, connectionId: string): void {
    if (!this.windows.has(windowId)) return
    let set = this.subscriptions.get(connectionId)
    if (!set) {
      set = new Set()
      this.subscriptions.set(connectionId, set)
    }
    set.add(windowId)
  }

  /**
   * Remove a subscription. Returns `true` if this was the last subscriber
   * (i.e. the connection is now orphaned).
   */
  unsubscribe(windowId: string, connectionId: string): boolean {
    const set = this.subscriptions.get(connectionId)
    if (!set) return false
    set.delete(windowId)
    if (set.size === 0) {
      this.subscriptions.delete(connectionId)
      return true
    }
    return false
  }

  /** Number of live windows watching `connectionId`. */
  refcount(connectionId: string): number {
    return this.subscriptions.get(connectionId)?.size ?? 0
  }

  /** Returns a snapshot of the subscription map — useful for debugging. */
  snapshot(): { windows: number; subscriptions: Record<string, number> } {
    const subs: Record<string, number> = {}
    for (const [connId, set] of this.subscriptions) {
      subs[connId] = set.size
    }
    return { windows: this.windows.size, subscriptions: subs }
  }

  // ── Broadcasting ──

  /**
   * Route an IPC event to every window subscribed to `connectionId`.
   * Destroyed windows are skipped silently.
   *
   * Use this instead of `BrowserWindow.fromWebContents(event.sender).webContents.send(...)`
   * or `BrowserWindow.getAllWindows()` loops in service/IPC code — it does the
   * right thing for both single-window and multi-window scenarios.
   */
  broadcastToConnection(connectionId: string, channel: string, ...args: unknown[]): void {
    const set = this.subscriptions.get(connectionId)
    if (!set || set.size === 0) return
    for (const windowId of set) {
      const record = this.windows.get(windowId)
      if (!record || record.browserWindow.isDestroyed()) continue
      record.browserWindow.webContents.send(channel, ...args)
    }
  }

  /**
   * Route an IPC event to every live window (regardless of subscription).
   * Use sparingly — prefer `broadcastToConnection` for connection-scoped events.
   * Good for truly global events like log entries or system notifications.
   */
  broadcastToAll(channel: string, ...args: unknown[]): void {
    for (const record of this.windows.values()) {
      if (!record.browserWindow.isDestroyed()) {
        record.browserWindow.webContents.send(channel, ...args)
      }
    }
  }

  // ── Event emitter ──

  on(event: EventName, fn: Listener): void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(fn)
  }

  off(event: EventName, fn: Listener): void {
    this.listeners.get(event)?.delete(fn)
  }

  private emit(event: EventName, ...args: unknown[]): void {
    const set = this.listeners.get(event)
    if (!set) return
    // Copy to array so a listener can safely off() itself during dispatch
    for (const fn of [...set]) {
      try {
        fn(...args)
      } catch (err) {
        console.error(`[WindowManager] listener error for ${event}:`, err)
      }
    }
  }

  // ── Internal ──

  private onWindowClosed(windowId: string): void {
    // Collect connections that lost their last subscriber due to this close
    const orphaned: string[] = []
    for (const [connId, set] of this.subscriptions) {
      if (set.delete(windowId) && set.size === 0) {
        this.subscriptions.delete(connId)
        orphaned.push(connId)
      }
    }
    this.windows.delete(windowId)

    if (orphaned.length > 0) {
      this.emit('connections-orphaned', orphaned)
    }
    this.emit('window-closed', windowId)
  }
}

/** Process-wide singleton. */
export const windowManager = new WindowManager()
