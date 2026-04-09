import { useEffect, useMemo, useState } from 'react'
import { v4 as uuid } from 'uuid'
import { useTheme } from '@/hooks/useTheme'
import { useConnectionSubscription } from '@/hooks/useConnectionSubscription'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useLogStore } from '@/stores/logStore'
import { useUIStore } from '@/stores/uiStore'
import {
  useSQLStore,
  hydrateConnectionSlice,
  type SQLConnectionSlice,
} from '@/stores/sqlStore'
import { applyAccentColor, applyDensity } from '@/utils/appearance'
import { useKeybindingStore } from '@/stores/keybindingStore'
import { DatabaseView } from '@/components/DatabaseView'
import { TitleBar } from '@/components/layout/TitleBar'
import { ToastContainer, toast } from '@/components/ui/Toast'
import { getStandaloneHandoffOnce, type StandaloneConfig } from '@/standalone'
import { markHandoffInFlight } from '@/utils/handoff'
import type { ConnectionTab, ConnectionStatus } from '@/types/session'

interface StandaloneDatabaseAppProps {
  config: StandaloneConfig
}

interface HandoffState {
  connectionId: string
  sessionId: string
  sqlSessionId?: string | null
  viaSSHConnectionId?: string
  sqlSlice?: SQLConnectionSlice
  name?: string
  sessionColor?: string
}

/**
 * Minimal app shell for a standalone SQL window.
 *
 * This component:
 *   1. Fetches any pending handoff state from the main process (for tab
 *      tear-off flows) — if present, reuses the existing connectionId and
 *      hydrates the sqlStore slice so the new window continues where the
 *      source left off. Otherwise generates a fresh connectionId for a
 *      direct sidebar launch.
 *   2. Bootstraps the usual settings/theme side-effects
 *   3. Creates a single database tab (fresh or adopted)
 *   4. Subscribes to the connection's event stream via WindowManager
 *   5. Listens to the SQL-related IPC events we care about for this window
 *
 * Connection cleanup on window close is handled automatically via
 * refcounted orphaned-connection cleanup in main.ts — no manual teardown needed.
 */
export function StandaloneDatabaseApp({ config }: StandaloneDatabaseAppProps) {
  useTheme()

  const { tabs, addTab } = useConnectionStore()
  const { addEntry } = useLogStore()
  const { setTheme } = useUIStore()

  // We have to fetch the handoff BEFORE the first render path that would
  // create a tab. The connectionId lives in state (not a ref) so React
  // re-renders pick it up after StrictMode-safe handoff resolution.
  const [handoffResolved, setHandoffResolved] = useState(false)
  const [handoff, setHandoff] = useState<HandoffState | null>(null)
  const [connectionId, setConnectionId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Use the module-level cache so StrictMode's double-invocation of the
    // mount effect doesn't consume the single-use handoff twice.
    getStandaloneHandoffOnce<HandoffState>()
      .then((state) => {
        if (cancelled) return
        if (state) {
          setHandoff(state)
          // Reuse the existing connectionId so the main process sees us as
          // the continued owner of the session.
          const id = state.connectionId || uuid()
          setConnectionId(id)
          if (state.sqlSlice) {
            hydrateConnectionSlice(id, state.sqlSlice)
            // This standalone window OWNS the SQL connection for its entire
            // lifetime. Mark the handoff flag persistently so SQLView's
            // StrictMode dev double-mount (and any transient unmounts) skip
            // the disconnect + reset path that would otherwise kill the
            // hydrated session. Cleanup on real window close is handled by
            // WindowManager's refcounted orphan cleanup in the main process.
            markHandoffInFlight(id, { timeoutMs: 'persistent' })
          }
        } else {
          // Direct sidebar launch — generate a fresh connectionId.
          setConnectionId(uuid())
        }
        setHandoffResolved(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Subscribe this window to the connection's event stream. For handoff mode
  // the main process has already pre-subscribed us — this call is idempotent
  // and just keeps the subscription alive for the component lifecycle. For
  // direct-launch mode it's the first subscription, taking effect before any
  // ssh/sql/monitor IPC is issued.
  useConnectionSubscription(connectionId)

  // ── Load persisted settings (theme/accent/density/keybindings) ──
  useEffect(() => {
    window.novadeck.settings
      .getAll()
      .then((saved) => {
        if (saved?.theme) setTheme(saved.theme)
        if (saved?.accentColor) applyAccentColor(saved.accentColor)
        if (saved?.density) applyDensity(saved.density)
      })
      .catch((err) => {
        console.warn('[standalone] failed to load settings:', err)
      })

    useKeybindingStore.getState().loadBindings().catch((err) => {
      console.warn('[standalone] failed to load keybindings:', err)
    })
  }, [setTheme])

  // ── Create the single database tab in this window's store ──
  useEffect(() => {
    if (!connectionId) return

    const existing = useConnectionStore.getState().tabs.find(t => t.id === connectionId)
    if (existing) return

    // Source-of-truth order:
    //   1. Handoff payload (if tearing off an existing tab)
    //   2. sessionStore (if the session is saved locally)
    //   3. URL params (fallback)
    const saved = useSessionStore.getState().sessions.find(s => s.id === config.sessionId)

    // In handoff mode the connection is already established in the main
    // process — reflect that in the initial tab status so the DatabaseView
    // doesn't show a disconnected shell.
    const initialStatus: ConnectionStatus = handoff?.sqlSlice?.connectionStatus === 'connected'
      ? 'connected'
      : 'disconnected'

    const tab: ConnectionTab = {
      id: connectionId,
      sessionId: config.sessionId,
      sessionName: saved?.name || handoff?.name || config.name,
      sessionColor: saved?.color || handoff?.sessionColor || config.sessionColor,
      type: 'database',
      status: initialStatus,
      activeSubTab: 'sql',
    }
    addTab(tab)
  }, [addTab, config, connectionId, handoff])

  // If the handoff included an SSH tunnel connectionId, also subscribe to it
  // so the tunnel stays alive while this window is open.
  useConnectionSubscription(handoff?.viaSSHConnectionId ?? null)

  // ── Wire SQL-related IPC events (scoped to this window) ──
  useEffect(() => {
    const unsubLog = window.novadeck.log.onEntry((sessionId: string, entry) => {
      addEntry(sessionId, entry as any)
    })

    const unsubSQLConnError = window.novadeck.sql.onConnectionError((sqlSessionId, errorMessage) => {
      console.warn(`[SQL] Connection error (${sqlSessionId}):`, errorMessage)
    })

    const unsubSQLReconnected = window.novadeck.sql.onConnectionReconnected((sqlSessionId) => {
      console.log(`[SQL] Connection reconnected (${sqlSessionId})`)
      toast.success('Connection Restored', 'Database connection was re-established automatically.')
    })

    const unsubSQLConnLost = window.novadeck.sql.onConnectionLost((sqlSessionId, errorMessage) => {
      console.warn(`[SQL] Connection lost (${sqlSessionId}):`, errorMessage)
      const state = useSQLStore.getState()
      for (const [connId, slice] of Object.entries(state.connections) as [string, any][]) {
        if (slice.sqlSessionId === sqlSessionId) {
          state.setConnectionStatus(connId, 'error')
          state.setConnectionError(connId, 'Connection lost. Click Reconnect to re-establish.')
          break
        }
      }
    })

    const unsubSystemResume = window.novadeck.system.onResume(() => {
      toast.info('System Resumed', 'Connections may need to be re-established.')
    })

    return () => {
      unsubLog()
      unsubSQLConnError()
      unsubSQLReconnected()
      unsubSQLConnLost()
      unsubSystemResume()
    }
  }, [addEntry])

  // Connection cleanup on window close is handled automatically by
  // WindowManager: when the last subscriber unsubscribes (via
  // useConnectionSubscription's cleanup), main.ts's connections-orphaned
  // listener calls disconnectSQLByConnectionId. No manual beforeunload hook.

  const tab = useMemo(
    () => (connectionId ? tabs.find(t => t.id === connectionId) : undefined),
    [tabs, connectionId]
  )

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-nd-bg-primary">
      <TitleBar />

      <main className="flex-1 overflow-hidden">
        {tab ? (
          <DatabaseView tab={tab} />
        ) : (
          <div className="flex items-center justify-center h-full text-nd-text-muted text-sm">
            {handoffResolved ? 'Loading…' : 'Fetching window state…'}
          </div>
        )}
      </main>

      <ToastContainer />
    </div>
  )
}
