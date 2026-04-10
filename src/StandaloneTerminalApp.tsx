import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftToLine } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { useConnectionSubscription } from '@/hooks/useConnectionSubscription'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useUIStore } from '@/stores/uiStore'
import { applyAccentColor, applyDensity } from '@/utils/appearance'
import { useKeybindingStore } from '@/stores/keybindingStore'
import { TerminalView } from '@/components/terminal/TerminalView'
import { TitleBar } from '@/components/layout/TitleBar'
import { ToastContainer, toast } from '@/components/ui/Toast'
import { resolveTerminalSettings, type ResolvedTerminalSettings } from '@/utils/resolveSettings'
import { getStandaloneHandoffOnce, type StandaloneConfig } from '@/standalone'
import type { ConnectionTab, ConnectionStatus } from '@/types/session'
import type { AppSettings } from '@/types/settings'

interface StandaloneTerminalAppProps {
  config: StandaloneConfig
}

/** Fields we care about from the terminal handoff payload. */
interface TerminalHandoffState {
  connectionId: string
  sessionId: string
  shellId?: string
  bufferSnapshot?: string
  name?: string
  sessionColor?: string
}

/**
 * Minimal app shell for a standalone Terminal window.
 *
 * Single-owner semantics: the main process shell is transferred from the
 * source window to this window. We reuse the existing shellId and tell
 * TerminalView to attach to the existing shell (skipping terminal:open) and
 * to replay the handed-off buffer snapshot before any live data arrives.
 *
 * This component:
 *   1. Fetches any pending handoff state from the main process (via the
 *      StrictMode-safe cached helper). If missing or malformed, logs a
 *      warning and renders a fallback — direct-launch terminal windows are
 *      out-of-scope for Phase 2 because there's no existing shell to adopt.
 *   2. Subscribes to the connection's event stream via WindowManager so
 *      terminal:data events continue to reach this window after tear-off.
 *   3. Bootstraps the usual settings/theme side-effects.
 *   4. Creates a single SSH tab (status='connected') so TerminalView has a
 *      valid connectionStatus to gate shell attach on.
 *   5. Renders a bare TerminalView (no sub-tab bar, no snippet palette — the
 *      user can still use xterm's built-in keyboard shortcuts).
 *
 * Connection cleanup on window close is handled automatically via
 * refcounted orphaned-connection cleanup in main.ts — no manual teardown
 * needed.
 */
export function StandaloneTerminalApp({ config }: StandaloneTerminalAppProps) {
  useTheme()

  const { tabs, addTab, updateTab } = useConnectionStore()
  const { setTheme } = useUIStore()

  const [handoffResolved, setHandoffResolved] = useState(false)
  const [handoff, setHandoff] = useState<TerminalHandoffState | null>(null)
  // connectionId + shellId live in state (not refs) so React re-renders pick
  // up the correct values when StrictMode double-invokes the handoff effect.
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [shellId, setShellId] = useState<string | null>(null)
  const [bufferSnapshot, setBufferSnapshot] = useState<string | undefined>(undefined)
  const [resolvedSettings, setResolvedSettings] = useState<ResolvedTerminalSettings | undefined>()
  // Set to true before calling mergeBack so the beforeunload handler knows NOT
  // to kill the shell — the main window is taking ownership.
  const mergingRef = useRef(false)
  // True when the remote session ends (shell:close / exit event) so we can show
  // a "session ended" overlay without relying on xterm's printed message alone.
  const [shellExited, setShellExited] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Use the module-level cache so StrictMode's double-invocation doesn't
    // consume the single-use handoff twice.
    getStandaloneHandoffOnce<TerminalHandoffState>()
      .then((state) => {
        if (cancelled) return
        if (state && state.connectionId && state.shellId) {
          setHandoff(state)
          setConnectionId(state.connectionId)
          setShellId(state.shellId)
          setBufferSnapshot(state.bufferSnapshot)
        } else {
          console.warn(
            '[standalone:terminal] no handoff with shellId — direct launch not supported'
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
        console.warn('[standalone:terminal] failed to load settings:', err)
      })

    useKeybindingStore.getState().loadBindings().catch((err) => {
      console.warn('[standalone:terminal] failed to load keybindings:', err)
    })
  }, [setTheme])

  // ── Resolve terminal settings (global + session overrides) ──
  useEffect(() => {
    const sessionId = handoff?.sessionId ?? config.sessionId
    window.novadeck.settings.getAll().then((globalSettings: AppSettings) => {
      const saved = useSessionStore.getState().sessions.find(s => s.id === sessionId)
      const termOverrides = saved?.overrides?.terminal
      setResolvedSettings(resolveTerminalSettings(globalSettings, termOverrides))
    }).catch((err) => {
      console.warn('[standalone:terminal] failed to resolve terminal settings:', err)
    })
  }, [handoff, config.sessionId])

  // ── Create the single terminal tab in this window's store ──
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
      activeSubTab: 'terminal',
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

  // ── Close the main-process shell when the window is actually closing ──
  //
  // `beforeunload` fires exactly once when the BrowserWindow is destroyed —
  // NOT on React StrictMode dev double-mounts (which are purely component-
  // tree transitions within the same window), and NOT on hot reload
  // (which triggers a different path). Using the React useEffect cleanup
  // instead would fire on every StrictMode unmount and prematurely kill
  // the shell between double-invocations.
  //
  // Without this, the shell would linger in SSHService.shells and
  // terminal.ipc.ts's activeShells until the underlying SSH connection is
  // torn down, even after the user closes the standalone window.
  useEffect(() => {
    if (!shellId) return
    const handler = () => {
      // During merge-back the main window takes ownership of the shell —
      // do NOT close it here or the adopted shell will be killed on close.
      if (mergingRef.current) return
      try {
        window.novadeck.terminal.close(shellId)
      } catch {
        // ignore — window is going away anyway
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [shellId])

  // ── Detect shell exit so we can show the "Session ended" overlay ──
  useEffect(() => {
    if (!shellId) return
    const unsub = window.novadeck.terminal.onExit((exitedShellId: string, _code: number) => {
      if (exitedShellId === shellId) {
        setShellExited(true)
      }
    })
    return () => { unsub() }
  }, [shellId])

  // ── Merge this standalone terminal window back into the main window ──
  const handleMergeBack = useCallback(async () => {
    if (!connectionId || !shellId) return
    try {
      mergingRef.current = true
      const result = await window.novadeck.window.mergeBack({
        mode: 'terminal',
        connectionId,
        sessionId: handoff?.sessionId ?? config.sessionId,
        name: handoff?.name ?? config.name,
        sessionColor: handoff?.sessionColor ?? config.sessionColor,
        shellId,
        bufferSnapshot: bufferSnapshot,
      })
      if (!result.ok) {
        mergingRef.current = false
        toast.error('Merge failed', result.reason || 'Main window not available')
        return
      }
      window.novadeck.window.close()
    } catch (err) {
      mergingRef.current = false
      toast.error('Merge failed', err instanceof Error ? err.message : String(err))
    }
  }, [connectionId, shellId, handoff, config, bufferSnapshot])

  const tab = useMemo(
    () => (connectionId ? tabs.find(t => t.id === connectionId) : undefined),
    [tabs, connectionId]
  )

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
      title="Merge this terminal back into the main Shellway window"
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

      <main className="flex-1 overflow-hidden relative">
        {!handoffResolved ? (
          <div className="flex items-center justify-center h-full text-nd-text-muted text-sm">
            Fetching window state…
          </div>
        ) : !connectionId || !shellId ? (
          <div className="flex items-center justify-center h-full text-nd-text-muted text-sm">
            No terminal session available.
          </div>
        ) : tab && resolvedSettings ? (
          <TerminalView
            shellId={shellId}
            connectionId={tab.id}
            connectionStatus="connected"
            isActive
            terminalSettings={resolvedSettings}
            attachToExistingShell
            initialBufferSnapshot={bufferSnapshot}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-nd-text-muted text-sm">
            Loading…
          </div>
        )}

        {/* Session-ended overlay — shown when the remote shell exits */}
        {shellExited && (
          <div className="absolute inset-0 flex items-center justify-center bg-nd-bg-primary/80 z-10">
            <div className="text-center space-y-3">
              <p className="text-nd-text-secondary text-sm">Session ended</p>
              <button
                onClick={() => window.novadeck.window.close()}
                className="px-3 py-1.5 rounded text-xs bg-nd-surface hover:bg-nd-accent/20 text-nd-text-secondary hover:text-nd-accent transition-colors"
              >
                Close window
              </button>
            </div>
          </div>
        )}
      </main>

      <ToastContainer />
    </div>
  )
}
