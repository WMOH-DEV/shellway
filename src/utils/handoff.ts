/**
 * Handoff guard — a transient in-memory set of connectionIds that are in the
 * middle of being transferred to another window (e.g. during a tab tear-off).
 *
 * Problem this solves:
 *
 * `SQLView` has an unmount-cleanup effect that calls `window.novadeck.sql.disconnect(sid)`
 * whenever it unmounts. This is the right behavior for "user closed the tab" —
 * we want the DB connection to go away. But when the user POPS OUT a tab to a
 * new window, the source window removes the tab (→ SQLView unmounts) even
 * though the connection should stay alive because another window is about to
 * own it.
 *
 * Solution: before calling `removeTab` during a pop-out, mark the connectionId
 * as "being handed off". SQLView's unmount cleanup checks this set and skips
 * the disconnect if the flag is set. After a short timeout the flag auto-clears
 * as a safety net in case the pop-out fails midway.
 *
 * This is a local-only set — it never crosses the IPC boundary. The main
 * process WindowManager handles the actual refcounting; this flag is purely a
 * renderer-side shim to avoid the legacy cleanup path during a handoff.
 */

const inFlight = new Set<string>()

interface MarkOptions {
  /**
   * Milliseconds after which the flag auto-clears. Defaults to 5000ms (safety
   * net for failed pop-outs in the source window). Pass `'persistent'` to
   * suppress auto-clear entirely — used by standalone receiver windows that
   * own the connection for the entire renderer lifetime.
   */
  timeoutMs?: number | 'persistent'
}

/**
 * Mark a connectionId as being handed off — disables local cleanup hooks.
 *
 * Two usage modes:
 *   - Source window (tab tear-off): default 5s timeout, auto-clears as a
 *     safety net in case the pop-out fails midway.
 *   - Receiver window (standalone app bootstrap): pass
 *     `{ timeoutMs: 'persistent' }` so React StrictMode dev double-mount
 *     (and other transient unmounts) don't trigger the SQLView cleanup
 *     path. The main-process WindowManager handles cleanup via refcount
 *     when the window actually closes, so the renderer-side cleanup is
 *     redundant and must be suppressed for the window's lifetime.
 */
export function markHandoffInFlight(
  connectionId: string,
  options: MarkOptions | number = {},
): void {
  inFlight.add(connectionId)
  const opts: MarkOptions = typeof options === 'number' ? { timeoutMs: options } : options
  const timeoutMs = opts.timeoutMs ?? 5000
  if (timeoutMs === 'persistent') return
  setTimeout(() => inFlight.delete(connectionId), timeoutMs)
}

/** Clear the flag explicitly (after a successful pop-out completes). */
export function clearHandoffInFlight(connectionId: string): void {
  inFlight.delete(connectionId)
}

/** Check whether a connection is currently being handed off. */
export function isHandoffInFlight(connectionId: string): boolean {
  return inFlight.has(connectionId)
}
