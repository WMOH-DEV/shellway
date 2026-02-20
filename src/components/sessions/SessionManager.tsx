import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Plus, Download, Upload, Search, ChevronDown,
  Globe, Database, Container, Cloud, Cpu, Terminal
} from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useSessionStore } from '@/stores/sessionStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useUIStore } from '@/stores/uiStore'
import { SessionCard } from './SessionCard'
import { SessionGroups } from './SessionGroups'
import { SessionForm, type SessionFormData } from './SessionForm'
import { QuickConnect } from './QuickConnect'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { sessionTemplates, type SessionTemplate } from '@/data/sessionTemplates'
import type { Session } from '@/types/session'
import { v4 as uuid } from 'uuid'

/** Map template icon name to Lucide component */
const TEMPLATE_ICONS: Record<string, typeof Globe> = {
  Globe, Database, Container, Cloud, Cpu, Terminal
}

interface SessionManagerProps {
  onConnect: (session: Session, defaultSubTab?: 'terminal' | 'sftp') => void
}

/**
 * Full session management panel — lives in the sidebar.
 * Handles create, edit, delete, duplicate, import, export, groups, search.
 */
export function SessionManager({ onConnect }: SessionManagerProps) {
  const {
    sessions,
    createSession,
    editSession,
    deleteSession,
    duplicateSession,
    exportSessions,
    importSessions
  } = useSession()

  const { searchQuery, setSearchQuery, selectedSessionId, setSelectedSession } = useSessionStore()
  const { tabs } = useConnectionStore()
  const { sessionFormRequested, clearSessionFormRequest } = useUIStore()

  // Form state
  const [formOpen, setFormOpen] = useState(false)
  const [editingSession, setEditingSession] = useState<Session | null>(null)
  const [templateDefaults, setTemplateDefaults] = useState<Partial<Session> | null>(null)

  // Template dropdown
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false)
  const templateMenuRef = useRef<HTMLDivElement>(null)

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null)

  // Groups
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [groups, setGroups] = useState<string[]>([])

  // React to session form requests from WelcomeScreen
  useEffect(() => {
    if (sessionFormRequested) {
      setEditingSession(null)
      setTemplateDefaults(null)
      setFormOpen(true)
      clearSessionFormRequest()
    }
  }, [sessionFormRequested, clearSessionFormRequest])

  // Close template menu on click outside
  useEffect(() => {
    if (!templateMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (templateMenuRef.current && !templateMenuRef.current.contains(e.target as Node)) {
        setTemplateMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [templateMenuOpen])

  const handleSelectTemplate = useCallback((template: SessionTemplate) => {
    setTemplateMenuOpen(false)
    setEditingSession(null)
    setTemplateDefaults(template.defaults as Partial<Session>)
    setFormOpen(true)
  }, [])

  // Compute filtered sessions
  const filteredSessions = useMemo(() => {
    if (!searchQuery) return sessions
    const q = searchQuery.toLowerCase()
    return sessions.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q) ||
        s.username.toLowerCase().includes(q) ||
        (s.group && s.group.toLowerCase().includes(q))
    )
  }, [sessions, searchQuery])

  // Sort: recently connected first, then alphabetical
  const sortedSessions = useMemo(() => {
    return [...filteredSessions].sort((a, b) => {
      if (a.lastConnected && b.lastConnected) return b.lastConnected - a.lastConnected
      if (a.lastConnected) return -1
      if (b.lastConnected) return 1
      return a.name.localeCompare(b.name)
    })
  }, [filteredSessions])

  // Handlers
  const handleSave = useCallback(
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
          notes: data.notes || undefined
        }

      if (editingSession) {
        await editSession(editingSession.id, sessionData)
        toast.success('Session updated', `${data.name} has been saved`)
      } else {
        await createSession(sessionData)
        toast.success('Session created', `${data.name || data.host} has been added`)
      }
      setEditingSession(null)
    },
    [editingSession, editSession, createSession]
  )

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    await deleteSession(deleteTarget.id)
    toast.info('Session deleted', `${deleteTarget.name} has been removed`)
    setDeleteTarget(null)
  }, [deleteTarget, deleteSession])

  const handleDuplicate = useCallback(
    async (id: string) => {
      const dup = await duplicateSession(id)
      if (dup) toast.success('Session duplicated')
    },
    [duplicateSession]
  )

  const handleExport = useCallback(async () => {
    const ok = await exportSessions()
    if (ok) toast.success('Sessions exported')
  }, [exportSessions])

  const handleImport = useCallback(async () => {
    const count = await importSessions()
    if (count > 0) toast.success(`Imported ${count} sessions`)
    else toast.info('No new sessions imported')
  }, [importSessions])

  const handleQuickConnect = useCallback(
    (host: string, port: number, username: string) => {
      // Create a temporary session for quick connect
      const session: Session = {
        id: uuid(),
        name: `${username}@${host}`,
        host,
        port,
        username,
        auth: { initialMethod: 'password' },
        proxy: { type: 'none', host: '', port: 1080, requiresAuth: false },
        overrides: {},
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      onConnect(session)
    },
    [onConnect]
  )

  const toggleGroup = useCallback((group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }, [])

  const getConnectionStatus = (sessionId: string) => {
    const tab = tabs.find((t) => t.sessionId === sessionId)
    return tab?.status
  }

  return (
    <>
      {/* Quick connect */}
      <div className="px-3 py-2 shrink-0">
        <QuickConnect onConnect={handleQuickConnect} />
      </div>

      {/* Search */}
      <div className="px-3 pb-2 shrink-0">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nd-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sessions..."
            className="w-full h-7 pl-8 pr-3 rounded bg-nd-surface border border-nd-border text-xs text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent transition-colors"
          />
        </div>
      </div>

      {/* New session + actions */}
      <div className="px-3 pb-2 shrink-0 flex gap-1.5">
        <Button
          variant="primary"
          size="sm"
          className="flex-1"
          onClick={() => {
            setEditingSession(null)
            setTemplateDefaults(null)
            setFormOpen(true)
          }}
        >
          <Plus size={14} />
          New Session
        </Button>
        <div className="relative" ref={templateMenuRef}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTemplateMenuOpen((v) => !v)}
            title="From template"
          >
            <ChevronDown size={14} />
          </Button>
          {templateMenuOpen && (
            <div className="absolute left-0 top-full mt-1 w-56 rounded-lg border border-nd-border bg-nd-bg-secondary shadow-xl z-50 py-1">
              <p className="px-3 py-1.5 text-2xs font-semibold text-nd-text-muted uppercase tracking-wider">Templates</p>
              {sessionTemplates.map((tpl) => {
                const Icon = TEMPLATE_ICONS[tpl.icon] || Terminal
                return (
                  <button
                    key={tpl.name}
                    onClick={() => handleSelectTemplate(tpl)}
                    className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-nd-surface transition-colors"
                  >
                    <Icon size={14} className="text-nd-accent mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-nd-text-primary truncate">{tpl.name}</p>
                      <p className="text-2xs text-nd-text-muted truncate">{tpl.description}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={handleImport} title="Import sessions">
          <Download size={14} />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleExport} title="Export sessions">
          <Upload size={14} />
        </Button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2">
        {sortedSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-12 h-12 rounded-xl bg-nd-surface flex items-center justify-center mb-3">
              <Search size={20} className="text-nd-text-muted" />
            </div>
            <p className="text-sm text-nd-text-secondary">
              {searchQuery ? 'No matching sessions' : 'No sessions yet'}
            </p>
            <p className="text-2xs text-nd-text-muted mt-1">
              {searchQuery
                ? 'Try a different search term'
                : 'Create your first SSH connection to get started'}
            </p>
          </div>
        ) : (
          <SessionGroups
            sessions={sortedSessions}
            expandedGroups={expandedGroups}
            onToggleGroup={toggleGroup}
            renderSession={(session) => (
              <SessionCard
                key={session.id}
                session={session}
                isSelected={session.id === selectedSessionId}
                connectionStatus={getConnectionStatus(session.id)}
                onSelect={() => setSelectedSession(session.id)}
                onConnect={() => onConnect(session)}
                onConnectTerminal={() => onConnect(session, 'terminal')}
                onConnectSFTP={() => onConnect(session, 'sftp')}
                onConnectBoth={() => onConnect(session)}
                onEdit={() => {
                  setEditingSession(session)
                  setFormOpen(true)
                }}
                onDuplicate={() => handleDuplicate(session.id)}
                onDelete={() => setDeleteTarget(session)}
              />
            )}
          />
        )}
      </div>

      {/* Session form slide-over */}
      <SessionForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setEditingSession(null)
          setTemplateDefaults(null)
        }}
        session={editingSession}
        templateDefaults={templateDefaults}
        groups={groups}
        onSave={handleSave}
      />

      {/* Delete confirmation modal */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Session"
        maxWidth="max-w-sm"
      >
        <p className="text-sm text-nd-text-secondary mb-4">
          Are you sure you want to delete <strong className="text-nd-text-primary">{deleteTarget?.name}</strong>?
          This action cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            Delete
          </Button>
        </div>
      </Modal>
    </>
  )
}
