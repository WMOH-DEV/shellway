import { useCallback, useState, useEffect } from 'react'
import {
  Settings,
  ChevronLeft,
  ChevronRight,
  Shield,
  KeyRound,
  Plus
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { useUIStore } from '@/stores/uiStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { SessionManager } from '@/components/sessions/SessionManager'
import { SessionForm, type SessionFormData } from '@/components/sessions/SessionForm'
import { useSession } from '@/hooks/useSession'
import { Tooltip } from '@/components/ui/Tooltip'
import { toast } from '@/components/ui/Toast'
import type { Session } from '@/types/session'

interface SidebarProps {
  onConnect: (session: Session, defaultSubTab?: 'terminal' | 'sftp') => void
}

/**
 * Left sidebar — the primary connection switcher (replaces top TabBar).
 * Session cards double as connection tabs: single-click switches, close disconnects.
 * Collapsible to icon-only (48px) with compact session avatars.
 */
export function Sidebar({ onConnect }: SidebarProps) {
  const { sidebarOpen, toggleSidebar, toggleSettings, toggleHostKeyManager, toggleClientKeyManager } = useUIStore()
  const { sessions } = useSessionStore()
  const { tabs, activeTabId, setActiveTab, removeTab } = useConnectionStore()

  const width = sidebarOpen ? 260 : 48

  // ── Session form for collapsed sidebar "+" button ──
  const { createSession } = useSession()
  const [collapsedFormOpen, setCollapsedFormOpen] = useState(false)
  const { sessionFormRequested, clearSessionFormRequest } = useUIStore()

  // Listen for sessionFormRequested when sidebar is collapsed
  useEffect(() => {
    if (sessionFormRequested && !sidebarOpen) {
      setCollapsedFormOpen(true)
      clearSessionFormRequest()
    }
  }, [sessionFormRequested, sidebarOpen, clearSessionFormRequest])

  const handleCollapsedFormSave = useCallback(
    async (data: SessionFormData) => {
      const sessionData = {
        name: data.name || `${data.username}@${data.host}`,
        group: data.group || undefined,
        host: data.host,
        port: data.port,
        username: data.username,
        auth: data.auth,
        proxy: data.proxy,
        overrides: data.overrides,
        color: data.color || undefined,
        defaultDirectory: data.defaultDirectory || undefined,
        startupCommands: data.startupCommands,
        encoding: data.encoding,
        shellCommand: data.shellCommand || undefined,
        terminalType: data.terminalType,
        environmentVariables: data.environmentVariables,
        viewPreferences: data.viewPreferences,
        notes: data.notes || undefined,
      }
      await createSession(sessionData as any)
      toast.success('Session created', `${data.name || data.host} has been added`)
      setCollapsedFormOpen(false)
    },
    [createSession]
  )

  const handleCloseTab = useCallback(
    (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      const tab = tabs.find((t) => t.sessionId === sessionId)
      if (tab) {
        window.novadeck.ssh.disconnect?.(tab.id).catch(() => {})
        removeTab(tab.id)
      }
    },
    [tabs, removeTab]
  )

  return (
    <aside
      className={cn(
        'flex flex-col h-full bg-nd-bg-secondary border-r border-nd-border shrink-0 transition-all duration-200 overflow-hidden'
      )}
      style={{ width }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 shrink-0 border-b border-nd-border">
        {sidebarOpen && (
          <span className="text-xs font-semibold text-nd-text-secondary uppercase tracking-wider">
            Sessions
          </span>
        )}
        <Tooltip content={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'} side="right">
          <button
            onClick={toggleSidebar}
            className="p-1 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
          >
            {sidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
        </Tooltip>
      </div>

      {sidebarOpen ? (
        <>
          {/* SessionManager handles everything — sessions are both saved items AND connection tabs */}
          <SessionManager onConnect={onConnect} />

          {/* Bottom Actions */}
          <div className="shrink-0 border-t border-nd-border px-3 py-2 flex items-center gap-1">
            <Tooltip content="Settings" side="top">
              <button
                onClick={toggleSettings}
                className="p-1.5 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
              >
                <Settings size={15} />
              </button>
            </Tooltip>
            <Tooltip content="Client Key Manager" side="top">
              <button
                onClick={toggleClientKeyManager}
                className="p-1.5 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
              >
                <KeyRound size={15} />
              </button>
            </Tooltip>
            <Tooltip content="Host Key Manager" side="top">
              <button
                onClick={toggleHostKeyManager}
                className="p-1.5 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
              >
                <Shield size={15} />
              </button>
            </Tooltip>
            <div className="flex-1" />
            <span className="text-2xs text-nd-text-muted">{sessions.length} sessions</span>
          </div>
        </>
      ) : (
        /* ── Collapsed icon-only view ── */
        <div className="flex flex-col items-center flex-1 overflow-hidden">
          {/* New session button */}
          <div className="shrink-0 py-1.5 w-full flex justify-center border-b border-nd-border">
            <Tooltip content="New Session" side="right">
              <button
                onClick={() => useUIStore.getState().requestSessionForm()}
                className="flex items-center justify-center w-9 h-7 rounded-md text-nd-accent hover:bg-nd-surface transition-colors"
              >
                <Plus size={16} />
              </button>
            </Tooltip>
          </div>
          <div className="flex flex-col items-center gap-0.5 py-1.5 flex-1 overflow-y-auto scrollbar-none w-full">
            {sessions.map((session) => {
                const tab = tabs.find((t) => t.sessionId === session.id)
                const isConnected = tab?.status === 'connected'
                const isConnecting = tab?.status === 'connecting' || tab?.status === 'authenticating'
                const isError = tab?.status === 'error'
                const isActive = tab?.id === activeTabId
                const hasConnection = !!tab

                return (
                  <Tooltip
                    key={session.id}
                    content={`${session.name}${hasConnection ? ' (connected)' : ''}`}
                    side="right"
                  >
                    <button
                      onClick={() => {
                        if (tab) {
                          setActiveTab(tab.id)
                        } else {
                          onConnect(session)
                        }
                      }}
                      className={cn(
                        'relative flex items-center justify-center w-9 h-8 rounded-md transition-colors shrink-0',
                        isActive
                          ? 'bg-nd-accent/15 ring-1 ring-nd-accent'
                          : hasConnection
                            ? 'bg-nd-surface/80'
                            : 'hover:bg-nd-surface opacity-60 hover:opacity-100'
                      )}
                    >
                      <div
                        className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold text-white/90"
                        style={{ backgroundColor: session.color || '#71717a' }}
                      >
                        {session.name.charAt(0).toUpperCase()}
                      </div>

                      {/* Status indicator */}
                      {isConnected && (
                        <span className="absolute bottom-0.5 right-1 w-2 h-2 rounded-full bg-nd-success border border-nd-bg-secondary" />
                      )}
                      {isConnecting && (
                        <span className="absolute bottom-0.5 right-1 w-2 h-2 rounded-full bg-nd-warning border border-nd-bg-secondary animate-pulse" />
                      )}
                      {isError && (
                        <span className="absolute bottom-0.5 right-1 w-2 h-2 rounded-full bg-nd-error border border-nd-bg-secondary" />
                      )}
                    </button>
                  </Tooltip>
                )
              })}
          </div>

          {/* Bottom actions */}
          <div className="flex flex-col items-center gap-1 py-2 shrink-0 border-t border-nd-border w-full">
            <Tooltip content="Client Key Manager" side="right">
              <button
                onClick={toggleClientKeyManager}
                className="p-2 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
              >
                <KeyRound size={16} />
              </button>
            </Tooltip>
            <Tooltip content="Host Key Manager" side="right">
              <button
                onClick={toggleHostKeyManager}
                className="p-2 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
              >
                <Shield size={16} />
              </button>
            </Tooltip>
            <Tooltip content="Settings" side="right">
              <button
                onClick={toggleSettings}
                className="p-2 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
              >
                <Settings size={16} />
              </button>
            </Tooltip>
          </div>
        </div>
      )}
      {/* Session form — rendered at sidebar level so it works when collapsed */}
      {collapsedFormOpen && (
        <SessionForm
          open={collapsedFormOpen}
          onClose={() => setCollapsedFormOpen(false)}
          groups={[...new Set(sessions.map((s) => s.group).filter(Boolean) as string[])]}
          onSave={handleCollapsedFormSave}
        />
      )}
    </aside>
  )
}
