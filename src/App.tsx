import { useEffect, useState, useCallback } from 'react'
import { useTheme } from '@/hooks/useTheme'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { AppShell } from '@/components/layout/AppShell'
import { ToastContainer } from '@/components/ui/Toast'
import { WelcomeScreen } from '@/components/WelcomeScreen'
import { ConnectionView } from '@/components/ConnectionView'
import { DatabaseView } from '@/components/DatabaseView'
import { cn } from '@/utils/cn'
import { SettingsView } from '@/components/settings/SettingsView'
import { HostKeyManager } from '@/components/keys/HostKeyManager'
import { ClientKeyManager } from '@/components/keys/ClientKeyManager'
import { HostKeyVerifyDialog } from '@/components/keys/HostKeyVerifyDialog'
import { KBDIDialog } from '@/components/sessions/KBDIDialog'
import { useConnectionStore } from '@/stores/connectionStore'
import { useUIStore } from '@/stores/uiStore'
import { applyAccentColor, applyDensity } from '@/utils/appearance'
import { useLogStore } from '@/stores/logStore'
import { toast } from '@/components/ui/Toast'

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

  const { tabs, activeTabId, updateTab, setReconnectionState, addReconnectionEvent } =
    useConnectionStore()
  const { settingsOpen, toggleSettings, hostKeyManagerOpen, toggleHostKeyManager, clientKeyManagerOpen, toggleClientKeyManager, setTheme } = useUIStore()
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
  }, [setTheme])

  // ── Host Key Verification state ──
  const [hostKeyVerify, setHostKeyVerify] = useState<HostKeyVerifyRequest | null>(null)

  // ── KBDI state ──
  const [kbdiPrompt, setKBDIPrompt] = useState<KBDIPromptState | null>(null)

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

  return (
    <AppShell>
      {/* Welcome screen when no tabs are open */}
      {tabs.length === 0 && <WelcomeScreen />}

      {/* Render ALL connection tabs — hide inactive via CSS to preserve state */}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn('h-full', tab.id !== activeTabId && 'hidden')}
        >
          {tab.type === 'database' ? (
            <DatabaseView tab={tab} />
          ) : (
            <ConnectionView tab={tab} />
          )}
        </div>
      ))}

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
    </AppShell>
  )
}
