import { useEffect, useState, useCallback } from 'react'
import { useTheme } from '@/hooks/useTheme'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { AppShell } from '@/components/layout/AppShell'
import { ToastContainer } from '@/components/ui/Toast'
import { WelcomeScreen } from '@/components/WelcomeScreen'
import { WorkspaceLayout } from '@/components/layout/WorkspaceLayout'
import { cn } from '@/utils/cn'
import { SettingsView } from '@/components/settings/SettingsView'
import { HostKeyManager } from '@/components/keys/HostKeyManager'
import { ClientKeyManager } from '@/components/keys/ClientKeyManager'
import { HostKeyVerifyDialog } from '@/components/keys/HostKeyVerifyDialog'
import { KBDIDialog } from '@/components/sessions/KBDIDialog'
import { DisconnectedSessionView } from '@/components/DisconnectedSessionView'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSQLStore, hydrateConnectionSlice, type SQLConnectionSlice } from '@/stores/sqlStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useUIStore } from '@/stores/uiStore'
import { useKeybindingStore } from '@/stores/keybindingStore'
import { applyAccentColor, applyDensity } from '@/utils/appearance'
import { useLogStore } from '@/stores/logStore'
import { toast } from '@/components/ui/Toast'
import { useUpdateStore } from '@/stores/updateStore'

// ── Types for IPC events ──

interface HostKeyVerifyRequest {
  connectionId: string
  host: string
  port: number
  keyType: string
  fingerprint: string
  type: 'new' | 'changed'
  previousFingerprint?: string
}

interface KBDIPromptState {
  connectionId: string
  name?: string
  instruction?: string
  prompts: { prompt: string; echo: boolean }[]
}

export default function App() {
  // Initialize theme listener and keyboard shortcuts
  useTheme()
  useKeyboardShortcuts()

  const { tabs, activeTabId, addTab, setActiveTab, updateTab, setReconnectionState, addReconnectionEvent } =
    useConnectionStore()
  const { sessions } = useSessionStore()
  const { settingsOpen, toggleSettings, hostKeyManagerOpen, toggleHostKeyManager, clientKeyManagerOpen, toggleClientKeyManager, setTheme, selectedSessionId, setSelectedSessionId, requestConnectSession } = useUIStore()
  const { addEntry } = useLogStore()

  // ── Load persisted settings on startup ──
  useEffect(() => {
    window.novadeck.settings.getAll().then((saved) => {
      if (saved?.theme) {
        setTheme(saved.theme)
      }
      if (saved?.accentColor) {
        applyAccentColor(saved.accentColor)
      }
      if (saved?.density) {
        applyDensity(saved.density)
      }
    }).catch((err) => {
      console.warn('Failed to load persisted settings on startup:', err)
    })

    // Load customized keybindings from settings
    useKeybindingStore.getState().loadBindings().catch((err) => {
      console.warn('Failed to load keybindings on startup:', err)
    })
  }, [setTheme])

  // ── Merge-back requests from standalone windows ──
  //
  // A standalone window (SQL / Monitor / SFTP / Terminal) can call
  // `window:mergeBack` to consolidate itself back into this main window.
  // The main process forwards the payload here; we reconstruct the tab
  // and focus it, then the standalone window closes itself.
  //
  // Current scope (MVP): SQL-mode merge-back creates a fresh top-level
  // database tab in main with the hydrated slice. Monitor/SFTP/Terminal
  // merge-back is deferred (see memory: project_multi_window_phase_2_deferred).
  useEffect(() => {
    const unsub = window.novadeck.window.onMergeRequest((payload) => {
      if (payload.mode === 'sql') {
        // Hydrate the SQL store slice BEFORE creating the tab so SQLView
        // reads the connected slice on first render (avoids a brief flash
        // of the "disconnected" Connect card).
        if (payload.sqlSlice) {
          hydrateConnectionSlice(payload.connectionId, payload.sqlSlice as SQLConnectionSlice)
        }

        // If a tab with this connectionId already exists (rare: the user
        // opened the standalone window from the sidebar while a matching
        // tab was already in main), just focus the existing tab instead
        // of duplicating it.
        const existing = useConnectionStore.getState().tabs.find(t => t.id === payload.connectionId)
        if (existing) {
          setActiveTab(payload.connectionId)
          toast.info('Merged', `"${payload.name || 'Database'}" is now in the main window`)
          return
        }

        addTab({
          id: payload.connectionId,
          sessionId: payload.sessionId,
          sessionName: payload.name || 'Database',
          sessionColor: payload.sessionColor,
          type: 'database',
          status: 'connected',
          activeSubTab: 'sql',
        })
        toast.success('Merged', `"${payload.name || 'Database'}" is now in the main window`)
      } else {
        // Monitor / SFTP / Terminal merge-back is not yet implemented.
        // The standalone window will still close itself (per its own
        // post-mergeBack logic), but the user loses access to the view.
        // Give them a heads-up.
        toast.info(
          'Merge pending',
          `${payload.mode.toUpperCase()} merge-back isn't supported yet — re-open from the SSH tab.`
        )
      }
    })
    return unsub
  }, [addTab, setActiveTab])

  // ── Host Key Verification state ──
  const [hostKeyVerify, setHostKeyVerify] = useState<HostKeyVerifyRequest | null>(null)

  // ── KBDI state ──
  const [kbdiPrompt, setKBDIPrompt] = useState<KBDIPromptState | null>(null)

  // ── Auto-update actions (from Zustand store) ──
  const { setChecking, setAvailable, setDownloadProgress, setReady, setNotAvailable, setError } = useUpdateStore()

  // ── Listen for events from main process ──
  useEffect(() => {
    // SSH status changes
    const unsubStatus = window.novadeck.ssh.onStatusChange((connectionId, status) => {
      updateTab(connectionId, { status: status as any })
    })

    // SSH errors
    const unsubError = window.novadeck.ssh.onError((connectionId, error) => {
      const tab = useConnectionStore.getState().tabs.find((t) => t.id === connectionId)
      toast.error('Connection error', `${tab?.sessionName || connectionId}: ${error}`)
      updateTab(connectionId, { status: 'error', error })
    })

    // SSH banner
    const unsubBanner = window.novadeck.ssh.onBanner((connectionId, message) => {
      addEntry(connectionId, {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        level: 'info',
        source: 'ssh',
        message: `Server banner: ${message.trim()}`,
        sessionId: connectionId
      })
    })

    // Activity Log entries
    const unsubLog = window.novadeck.log.onEntry((sessionId: string, entry: any) => {
      addEntry(sessionId, entry)
    })

    // Reconnection events
    const unsubReconnAttempt = window.novadeck.ssh.onReconnectAttempt((connectionId, attempt, maxAttempts) => {
      setReconnectionState(connectionId, {
        state: 'attempting',
        attempt,
        maxAttempts: maxAttempts ?? 0,
        nextRetryAt: null
      })
      addReconnectionEvent(connectionId, `Attempt ${attempt} — Connecting...`)
    })

    const unsubReconnWaiting = window.novadeck.ssh.onReconnectWaiting((connectionId, delayMs, nextAttempt, nextRetryAt) => {
      setReconnectionState(connectionId, {
        state: 'waiting',
        nextRetryAt: nextRetryAt || Date.now() + delayMs
      })
      addReconnectionEvent(connectionId, `Waiting ${Math.round(delayMs / 1000)}s before attempt ${nextAttempt}`)
    })

    const unsubReconnSuccess = window.novadeck.ssh.onReconnectSuccess((connectionId) => {
      setReconnectionState(connectionId, {
        state: 'idle',
        attempt: 0,
        nextRetryAt: null
      })
      addReconnectionEvent(connectionId, 'Reconnected successfully!')
      toast.success('Reconnected', 'Connection re-established.')
    })

    const unsubReconnFailed = window.novadeck.ssh.onReconnectFailed((connectionId, attempt, error) => {
      addReconnectionEvent(connectionId, `Attempt ${attempt} failed: ${error}`)
    })

    const unsubReconnExhausted = window.novadeck.ssh.onReconnectExhausted((connectionId) => {
      setReconnectionState(connectionId, {
        state: 'idle',
        nextRetryAt: null
      })
      addReconnectionEvent(connectionId, 'Reconnection attempts exhausted.')
      toast.error('Reconnection failed', 'All retry attempts exhausted.')
    })

    // Host key verification requests
    const unsubHostKeyVerify = window.novadeck.hostkey.onVerifyRequest((connectionId, info) => {
      setHostKeyVerify({
        connectionId,
        host: info.host,
        port: info.port,
        keyType: info.keyType,
        fingerprint: info.fingerprint,
        type: info.status,
        previousFingerprint: info.previousFingerprint
      })
    })

    // KBDI prompts
    const unsubKBDI = window.novadeck.ssh.onKBDIPrompt((connectionId, prompt: any) => {
      setKBDIPrompt({ connectionId, ...prompt })
    })

    // Auto-updater lifecycle events
    const unsubCheckingForUpdate = window.novadeck.updater.onCheckingForUpdate(() => {
      setChecking()
    })
    const unsubUpdateAvailable = window.novadeck.updater.onUpdateAvailable((info: any) => {
      setAvailable(info?.version ?? '')
    })
    const unsubUpdateNotAvailable = window.novadeck.updater.onUpdateNotAvailable(() => {
      setNotAvailable()
    })
    const unsubDownloadProgress = window.novadeck.updater.onDownloadProgress((progress) => {
      setDownloadProgress(progress)
    })
    const unsubUpdateDownloaded = window.novadeck.updater.onUpdateDownloaded((info: any) => {
      setReady(info?.version ?? '')
    })
    const unsubUpdateError = window.novadeck.updater.onError((message) => {
      setError(message)
    })

    // System resume (after sleep/wake) — notify user, connections may be stale
    const unsubSystemResume = window.novadeck.system.onResume(() => {
      toast.info('System Resumed', 'Connections may need to be re-established.')
    })

    // SQL connection errors (DB connection dropped during sleep/network loss)
    // Note: auto-reconnect is attempted server-side; these events are for logging only
    const unsubSQLConnError = window.novadeck.sql.onConnectionError((sqlSessionId, errorMessage) => {
      console.warn(`[SQL] Connection error (${sqlSessionId}):`, errorMessage)
    })

    // SQL connection successfully restored after a drop
    const unsubSQLReconnected = window.novadeck.sql.onConnectionReconnected((sqlSessionId) => {
      console.log(`[SQL] Connection reconnected (${sqlSessionId})`)
      toast.success('Connection Restored', 'Database connection was re-established automatically.')
    })

    // SQL connection lost and auto-reconnect failed
    const unsubSQLConnLost = window.novadeck.sql.onConnectionLost((sqlSessionId, errorMessage) => {
      console.warn(`[SQL] Connection lost (${sqlSessionId}):`, errorMessage)
      // Find the connectionId that owns this sqlSessionId and update its status
      const state = useSQLStore.getState()
      for (const [connId, slice] of Object.entries(state.connections) as [string, any][]) {
        if (slice.sqlSessionId === sqlSessionId) {
          state.setConnectionStatus(connId, 'error')
          state.setConnectionError(connId, 'Connection lost. Click Reconnect to re-establish.')
          break
        }
      }
    })

    return () => {
      unsubStatus()
      unsubError()
      unsubBanner()
      unsubLog()
      unsubReconnAttempt()
      unsubReconnWaiting()
      unsubReconnSuccess()
      unsubReconnFailed()
      unsubReconnExhausted()
      unsubHostKeyVerify()
      unsubKBDI()
      unsubCheckingForUpdate()
      unsubUpdateAvailable()
      unsubUpdateNotAvailable()
      unsubDownloadProgress()
      unsubUpdateDownloaded()
      unsubUpdateError()
      unsubSystemResume()
      unsubSQLConnError()
      unsubSQLReconnected()
      unsubSQLConnLost()
    }
  }, [updateTab, addEntry, setReconnectionState, addReconnectionEvent])

  // ── Host Key Verification handlers ──
  const handleHostKeyCancel = useCallback(() => {
    if (hostKeyVerify) {
      window.novadeck.hostkey.respondVerify(hostKeyVerify.connectionId, { action: 'disconnect' })
    }
    setHostKeyVerify(null)
  }, [hostKeyVerify])

  const handleHostKeyTrustOnce = useCallback(() => {
    if (hostKeyVerify) {
      window.novadeck.hostkey.respondVerify(hostKeyVerify.connectionId, { action: 'trust-once' })
    }
    setHostKeyVerify(null)
  }, [hostKeyVerify])

  const handleHostKeyTrustAndSave = useCallback(() => {
    if (hostKeyVerify) {
      window.novadeck.hostkey.respondVerify(hostKeyVerify.connectionId, { action: 'trust-save' })
    }
    setHostKeyVerify(null)
  }, [hostKeyVerify])

  const handleHostKeyAcceptNew = useCallback(() => {
    if (hostKeyVerify) {
      window.novadeck.hostkey.respondVerify(hostKeyVerify.connectionId, { action: 'accept-new' })
    }
    setHostKeyVerify(null)
  }, [hostKeyVerify])

  // ── KBDI handlers ──
  const handleKBDISubmit = useCallback(
    (responses: string[], _remember: boolean) => {
      if (kbdiPrompt) {
        window.novadeck.ssh.respondKBDI(kbdiPrompt.connectionId, responses)
      }
      setKBDIPrompt(null)
    },
    [kbdiPrompt]
  )

  const handleKBDICancel = useCallback(() => {
    if (kbdiPrompt) {
      window.novadeck.ssh.respondKBDI(kbdiPrompt.connectionId, [])
    }
    setKBDIPrompt(null)
  }, [kbdiPrompt])

  // ── Selected session preview (disconnected, no tab) ──
  const selectedSession = selectedSessionId
    ? sessions.find((s) => s.id === selectedSessionId)
    : null
  const showDisconnectedPreview = !!selectedSession
    && !tabs.find((t) => t.sessionId === selectedSessionId)

  return (
    <AppShell>
      {/* Welcome screen when no tabs and no selected session */}
      {tabs.length === 0 && !showDisconnectedPreview && <WelcomeScreen />}

      {/* Disconnected session preview (selected from sidebar, no tab yet) */}
      {showDisconnectedPreview && (
        <div className={cn('h-full', activeTabId && 'hidden')}>
          <DisconnectedSessionView
            sessionName={selectedSession!.name}
            sessionHost={selectedSession!.host}
            sessionPort={selectedSession!.port}
            sessionUsername={selectedSession!.username}
            sessionColor={selectedSession!.color}
            onConnect={() => requestConnectSession(selectedSession!.id)}
          />
        </div>
      )}

      {/* Workspace: renders all connection tabs via pane layout */}
      {tabs.length > 0 && <WorkspaceLayout />}

      {/* Settings modal */}
      <SettingsView open={settingsOpen} onClose={toggleSettings} />

      {/* Host Key Manager modal */}
      <HostKeyManager open={hostKeyManagerOpen} onClose={toggleHostKeyManager} />

      {/* Client Key Manager modal */}
      <ClientKeyManager open={clientKeyManagerOpen} onClose={toggleClientKeyManager} />

      {/* Host Key Verification dialog */}
      {hostKeyVerify && (
        <HostKeyVerifyDialog
          type={hostKeyVerify.type}
          host={hostKeyVerify.host}
          port={hostKeyVerify.port}
          keyType={hostKeyVerify.keyType}
          fingerprint={hostKeyVerify.fingerprint}
          previousFingerprint={hostKeyVerify.previousFingerprint}
          onCancel={handleHostKeyCancel}
          onTrustOnce={hostKeyVerify.type === 'new' ? handleHostKeyTrustOnce : undefined}
          onTrustAndSave={hostKeyVerify.type === 'new' ? handleHostKeyTrustAndSave : undefined}
          onAcceptNewKey={hostKeyVerify.type === 'changed' ? handleHostKeyAcceptNew : undefined}
          onDisconnect={hostKeyVerify.type === 'changed' ? handleHostKeyCancel : undefined}
        />
      )}

      {/* KBDI Authentication dialog */}
      {kbdiPrompt && (
        <KBDIDialog
          prompts={kbdiPrompt.prompts}
          name={kbdiPrompt.name}
          instruction={kbdiPrompt.instruction}
          onSubmit={handleKBDISubmit}
          onCancel={handleKBDICancel}
        />
      )}

      {/* Global toast notifications */}
      <ToastContainer />

      {/* Update UI is now rendered inside StatusBar */}
    </AppShell>
  )
}
