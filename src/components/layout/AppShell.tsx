import { useCallback, useEffect } from 'react'
import { TitleBar } from './TitleBar'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { useConnectionStore } from '@/stores/connectionStore'
import { useUIStore } from '@/stores/uiStore'
import { toast } from '@/components/ui/Toast'
import type { Session, ConnectionTab } from '@/types/session'
import { v4 as uuid } from 'uuid'

interface AppShellProps {
  children: React.ReactNode
}

/**
 * Main application layout shell.
 */
export function AppShell({ children }: AppShellProps) {
  const { addTab, tabs } = useConnectionStore()

  /** Handle connecting to a session — creates a connection tab */
  const handleConnect = useCallback(
    (session: Session, defaultSubTab?: 'terminal' | 'sftp' | 'both') => {
      // Resolve the sub-tab: explicit param > session viewPreferences > 'terminal'
      let resolvedSubTab: 'terminal' | 'sftp' = 'terminal'
      let enableSplitView = false

      if (defaultSubTab === 'both') {
        // Explicit "Open Terminal + SFTP" action
        resolvedSubTab = 'terminal'
        enableSplitView = true
      } else if (defaultSubTab) {
        // Explicit terminal or sftp — disable split view
        resolvedSubTab = defaultSubTab
        enableSplitView = false
      } else if (session.viewPreferences?.defaultView) {
        // Use session's configured default view preference
        const pref = session.viewPreferences.defaultView
        if (pref === 'terminal' || pref === 'sftp') {
          resolvedSubTab = pref
        } else if (pref === 'both') {
          resolvedSubTab = 'terminal'
          enableSplitView = true
        } else if (pref === 'last-used') {
          const lastUsed = localStorage.getItem(`shellway:lastView:${session.id}`)
          if (lastUsed === 'both') {
            resolvedSubTab = 'terminal'
            enableSplitView = true
          } else {
            resolvedSubTab = lastUsed === 'sftp' ? 'sftp' : 'terminal'
          }
        }
      }

      // Set global split view layout/ratio from session preferences (used by SplitView component)
      if (enableSplitView) {
        const layout = session.viewPreferences?.splitLayout ?? 'horizontal'
        const ratio = session.viewPreferences?.splitRatio ?? 0.5
        useUIStore.getState().setSplitView(true, layout, ratio)
      }

      // Check if already connected — use getState() for fresh data (avoids stale closure)
      const currentTabs = useConnectionStore.getState().tabs
      const existing = currentTabs.find((t) => t.sessionId === session.id && t.status === 'connected')
      if (existing) {
        useConnectionStore.getState().setActiveTab(existing.id)
        if (defaultSubTab === 'both') {
          // Enable split view on this tab, ensure we're on terminal/sftp
          const updates: Partial<ConnectionTab> = { splitView: true }
          if (existing.activeSubTab !== 'terminal' && existing.activeSubTab !== 'sftp') {
            updates.activeSubTab = 'terminal'
          }
          useConnectionStore.getState().updateTab(existing.id, updates)
        } else if (defaultSubTab) {
          // Explicit terminal or sftp — switch to it and disable split view
          useConnectionStore.getState().updateTab(existing.id, {
            activeSubTab: defaultSubTab,
            splitView: false
          })
        }
        return
      }

      const tab: ConnectionTab = {
        id: uuid(),
        sessionId: session.id,
        sessionName: session.name,
        sessionColor: session.color,
        type: 'ssh',
        status: 'connecting',
        activeSubTab: resolvedSubTab,
        splitView: enableSplitView
      }

      addTab(tab)
      toast.info('Connecting...', `Establishing connection to ${session.host}`)

      // Establish SSH connection via IPC
      window.novadeck.ssh
        .connect(tab.id, {
          host: session.host,
          port: session.port,
          username: session.username,
          auth: session.auth,
          proxy: session.proxy,
          overrides: session.overrides,
          encoding: session.encoding,
          terminalType: session.terminalType,
          shellCommand: session.shellCommand,
          environmentVariables: session.environmentVariables
        })
        .then((result) => {
          if (result.success) {
            useConnectionStore.getState().updateTab(tab.id, { status: 'connected' })
            toast.success('Connected', `Connected to ${session.name}`)
            // Touch session for "recently connected"
            window.novadeck.sessions.touch(session.id)
          } else {
            useConnectionStore.getState().updateTab(tab.id, {
              status: 'error',
              error: result.error
            })
            toast.error('Connection failed', result.error || 'Unknown error')
          }
        })
        .catch((err) => {
          useConnectionStore.getState().updateTab(tab.id, {
            status: 'error',
            error: String(err)
          })
          toast.error('Connection failed', String(err))
        })
    },
    [addTab]
  )

  /** Handle opening a standalone database connection tab */
  const handleConnectDatabase = useCallback(() => {
    const tabId = uuid()
    const sessionId = `db-${tabId}`

    const tab: ConnectionTab = {
      id: tabId,
      sessionId,
      sessionName: 'Database',
      type: 'database',
      status: 'disconnected',
      activeSubTab: 'sql'
    }

    addTab(tab)
  }, [addTab])

  // Listen for database connect requests from WelcomeScreen
  const { databaseConnectRequested, clearDatabaseConnectRequest } = useUIStore()
  useEffect(() => {
    if (databaseConnectRequested) {
      handleConnectDatabase()
      clearDatabaseConnectRequest()
    }
  }, [databaseConnectRequested, clearDatabaseConnectRequest, handleConnectDatabase])

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-nd-bg-primary">
      {/* Title bar */}
      <TitleBar />

      {/* Main area: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar onConnect={handleConnect} onConnectDatabase={handleConnectDatabase} />

        {/* Content area */}
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>

      {/* Status bar */}
      <StatusBar />
    </div>
  )
}
