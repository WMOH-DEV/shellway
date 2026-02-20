import { useCallback } from 'react'
import { TitleBar } from './TitleBar'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { StatusBar } from './StatusBar'
import { useConnectionStore } from '@/stores/connectionStore'
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
    (session: Session, defaultSubTab?: 'terminal' | 'sftp') => {
      // Check if already connected
      const existing = tabs.find((t) => t.sessionId === session.id && t.status === 'connected')
      if (existing) {
        useConnectionStore.getState().setActiveTab(existing.id)
        // If a specific sub-tab was requested, switch to it
        if (defaultSubTab) {
          useConnectionStore.getState().updateTab(existing.id, { activeSubTab: defaultSubTab })
        }
        return
      }

      const tab: ConnectionTab = {
        id: uuid(),
        sessionId: session.id,
        sessionName: session.name,
        sessionColor: session.color,
        status: 'connecting',
        activeSubTab: defaultSubTab || 'terminal'
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
    [addTab, tabs]
  )

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-nd-bg-primary">
      {/* Title bar */}
      <TitleBar />

      {/* Main area: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar onConnect={handleConnect} />

        {/* Content area */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Tab bar */}
          <TabBar />

          {/* Main content */}
          <main className="flex-1 overflow-hidden">{children}</main>
        </div>
      </div>

      {/* Status bar */}
      <StatusBar />
    </div>
  )
}
