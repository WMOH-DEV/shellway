import { useEffect } from 'react'

/**
 * Subscribe this renderer window to a connection's event stream in the main
 * process, for the lifetime of the component that calls this hook.
 *
 * Why this exists:
 *
 * The main process routes connection events (SSH output, SQL query results,
 * monitor data, SFTP transfer progress, …) via `WindowManager.broadcastToConnection`.
 * That broadcast only reaches windows that have explicitly subscribed to the
 * connectionId. In a single-window app this happens implicitly when the
 * renderer calls `ssh:connect` / `sql:connect` / etc. — the main process
 * auto-subscribes the caller. But when the *same* connection is opened from
 * a different window (e.g. a standalone pop-out), that window needs to
 * subscribe explicitly.
 *
 * Calling this hook is idempotent and safe even in single-window mode: the
 * main process dedupes subscriptions. On unmount, it unsubscribes. If this
 * was the last subscriber for the connection, the main process tears down
 * the underlying resource (SSH session, DB pool, monitor poller, …) via
 * refcounted cleanup.
 *
 * Pass `null` to disable subscription without dismounting the component
 * (useful for conditional rendering or lazy connection setup).
 */
export function useConnectionSubscription(connectionId: string | null | undefined): void {
  useEffect(() => {
    if (!connectionId) return

    let cancelled = false

    window.novadeck.window
      .subscribe(connectionId)
      .catch((err) => {
        console.warn(`[useConnectionSubscription] subscribe(${connectionId}) failed:`, err)
      })

    return () => {
      cancelled = true
      window.novadeck.window
        .unsubscribe(connectionId)
        .catch((err) => {
          if (!cancelled) {
            console.warn(`[useConnectionSubscription] unsubscribe(${connectionId}) failed:`, err)
          }
        })
    }
  }, [connectionId])
}
