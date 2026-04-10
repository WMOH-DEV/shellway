import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeftToLine } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { useConnectionSubscription } from '@/hooks/useConnectionSubscription'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useUIStore } from '@/stores/uiStore'
import { applyAccentColor, applyDensity } from '@/utils/appearance'
import { useKeybindingStore } from '@/stores/keybindingStore'
import { MonitorView } from '@/components/monitor/MonitorView'
import { TitleBar } from '@/components/layout/TitleBar'
import { ToastContainer, toast } from '@/components/ui/Toast'
import { getStandaloneHandoffOnce, type StandaloneConfig } from '@/standalone'
import type { ConnectionTab, ConnectionStatus } from '@/types/session'

interface StandaloneMonitorAppProps {
  config: StandaloneConfig
}

/** Fields we care about from the monitor handoff payload. */
interface MonitorHandoffState {
  connectionId: string
  sessionId: string
  name?: string
  sessionColor?: string
}

/**
 * Minimal app shell for a standalone monitor window.
 *
 * This component:
 *   1. Fetches any pending handoff state from the main process (for tab
 *      tear-off flows). If present, reuses the existing connectionId so the
 *      main process continues routing monitor data to this window.
 *      If missing (no handoff), it logs a warning and renders a fallback — a
 *      direct-launch monitor window is out-of-scope for Phase 3 because there
 *      is no active SSH session to poll.
 *   2. Bootstraps the usual settings/theme side-effects.
 *   3. Creates a single SSH tab with activeSubTab='monitor' so MonitorView
 *      receives a tab whose connection is already established.
 *   4. Subscribes to the connection's event stream via WindowManager to keep
 *      monitor data flowing for this window's lifetime.
 *
 * Connection cleanup on window close is handled automatically via
 * refcounted orphaned-connection cleanup in main.ts — no manual teardown needed.
 */
export function StandaloneMonitorApp({ config }: StandaloneMonitorAppProps) {
  useTheme()

  const { tabs, addTab, updateTab } = useConnectionStore()
  const { setTheme } = useUIStore()

  const [handoffResolved, setHandoffResolved] = useState(false)
  const [handoff, setHandoff] = useState<MonitorHandoffState | null>(null)
  // connectionId lives in state (not a ref) so React re-renders pick up the
  // correct value when StrictMode double-invokes the handoff effect.
  const [connectionId, setConnectionId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Use the module-level cache so StrictMode's double-invocation doesn't
    // consume the single-use handoff twice.
    getStandaloneHandoffOnce<MonitorHandoffState>()
      .then((state) => {
        if (cancelled) return
        if (state && state.connectionId) {
          setHandoff(state)
          setConnectionId(state.connectionId)
        } else {
          console.warn(
            '[standalone:monitor] no handoff state — direct launch not supported for monitor'
          )
        }
        setHandoffResolved(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Subscribe this window to the connection's event stream. Main process has
  // already pre-subscribed us via window:openStandalone — this is idempotent
  // and keeps the subscription alive for the component lifecycle.
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
        console.warn('[standalone:monitor] failed to load settings:', err)
      })

    useKeybindingStore.getState().loadBindings().catch((err) => {
      console.warn('[standalone:monitor] failed to load keybindings:', err)
    })
  }, [setTheme])

  // ── Create the single monitor tab in this window's store ──
  useEffect(() => {
    if (!connectionId) return

    const existing = useConnectionStore.getState().tabs.find(t => t.id === connectionId)
    if (existing) return

    const saved = useSessionStore.getState().sessions.find(s => s.id === (handoff?.sessionId ?? config.sessionId))

    const tab: ConnectionTab = {
      id: connectionId,
      sessionId: handoff?.sessionId ?? config.sessionId,
      sessionName: saved?.name || handoff?.name || config.name,
      sessionColor: saved?.color || handoff?.sessionColor || config.sessionColor,
      type: 'ssh',
      status: 'connected',
      activeSubTab: 'monitor',
    }
    addTab(tab)
  }, [addTab, config, connectionId, handoff])

  // ── Wire system-resume notification ──
  useEffect(() => {
    const unsubSystemResume = window.novadeck.system.onResume(() => {
      toast.info('System Resumed', 'Connections may need to be re-established.')
    })

    return () => {
      unsubSystemResume()
    }
  }, [])

  // ── Keep connection status badge in sync with SSH status changes ──
  useEffect(() => {
    if (!connectionId) return
    const unsub = window.novadeck.ssh.onStatusChange?.((changedConnId: string, status: string) => {
      if (changedConnId === connectionId) {
        updateTab(connectionId, { status: status as ConnectionStatus })
      }
    })
    return () => { unsub?.() }
  }, [connectionId, updateTab])

  const tab = useMemo(
    () => (connectionId ? tabs.find(t => t.id === connectionId) : undefined),
    [tabs, connectionId]
  )

  /**
   * Merge this standalone monitor window back into the main window.
   *
   * Monitor is read-only and stateless from the renderer's perspective —
   * all polling data lives in the main process. Merge-back just tells the
   * main window to activate its Monitor sub-tab for the same connectionId,
   * then this window closes. The main window's SSH tab must still exist;
   * if the user closed it, App.tsx's merge handler surfaces an error toast
   * and this window stays open so the data isn't lost.
   */
  const handleMergeBack = useCallback(async () => {
    if (!connectionId) return
    try {
      const result = await window.novadeck.window.mergeBack({
        mode: 'monitor',
        connectionId,
        sessionId: handoff?.sessionId ?? config.sessionId,
        name: handoff?.name ?? config.name,
        sessionColor: handoff?.sessionColor ?? config.sessionColor,
      })
      if (!result.ok) {
        toast.error('Merge failed', result.reason || 'Main window not available')
        return
      }
      window.novadeck.window.close()
    } catch (err) {
      toast.error('Merge failed', err instanceof Error ? err.message : String(err))
    }
  }, [connectionId, handoff, config])

  // ── Cmd+Shift+M → merge back ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'M') {
        e.preventDefault()
        handleMergeBack()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleMergeBack])

  const titleBarActions = connectionId ? (
    <button
      onClick={handleMergeBack}
      className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors text-nd-text-muted hover:text-nd-accent hover:bg-nd-surface"
      title="Merge this window back into the main Shellway window"
    >
      <ArrowLeftToLine size={12} />
      <span>Merge to main</span>
    </button>
  ) : null

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-nd-bg-primary">
      {(handoff?.sessionColor || config.sessionColor) && (
        <div className="h-0.5 shrink-0" style={{ backgroundColor: handoff?.sessionColor || config.sessionColor }} />
      )}
      <TitleBar actions={titleBarActions} />

      <main className="flex-1 overflow-hidden">
        {!handoffResolved ? (
          <div className="flex items-center justify-center h-full text-nd-text-muted text-sm">
            Fetching window state…
          </div>
        ) : !connectionId ? (
          <div className="flex items-center justify-center h-full text-nd-text-muted text-sm">
            No monitor session available.
          </div>
        ) : tab ? (
          <MonitorView
            connectionId={tab.id}
            sessionId={tab.sessionId}
            connectionStatus="connected"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-nd-text-muted text-sm">
            Loading…
          </div>
        )}
      </main>

      <ToastContainer />
    </div>
  )
}
