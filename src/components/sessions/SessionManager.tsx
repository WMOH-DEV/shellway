import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Plus, Download, Upload, Search } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useSessionStore } from '@/stores/sessionStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useUIStore } from '@/stores/uiStore'
import { SessionCard } from './SessionCard'
import { SessionGroups } from './SessionGroups'
import { SessionForm, type SessionFormData } from './SessionForm'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { ExportDialog } from './ExportDialog'
import { ImportDialog } from './ImportDialog'
import type { Session } from '@/types/session'

interface SessionManagerProps {
  onConnect: (session: Session, defaultSubTab?: 'terminal' | 'sftp' | 'both') => void
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
    reorderSessions,
    reload: reloadSessions,
  } = useSession()

  const { searchQuery, setSearchQuery } = useSessionStore()
  const { tabs, activeTabId, setActiveTab, removeTab } = useConnectionStore()
  const { sessionFormRequested, clearSessionFormRequest, expandedGroups, toggleGroup, selectedSessionId, setSelectedSessionId } = useUIStore()

  // Form state
  const [formOpen, setFormOpen] = useState(false)
  const [editingSession, setEditingSession] = useState<Session | null>(null)

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null)

  // Export/Import dialogs
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)

  // Groups
  const [groups, setGroups] = useState<string[]>([])

  // Load persisted groups + derive from session data
  const loadGroups = useCallback(async () => {
    const persisted = await window.novadeck.sessions.getGroups()
    // Merge persisted groups with groups derived from session data
    const sessionGroups = sessions.filter((s) => s.group).map((s) => s.group!)
    const merged = [...new Set([...persisted, ...sessionGroups])].sort()
    setGroups(merged)
  }, [sessions])

  useEffect(() => {
    loadGroups()
  }, [loadGroups])

  // Search visibility: auto-show when ≥5 sessions, toggleable when <5
  const fewSessions = sessions.length < 5
  const [searchForced, setSearchForced] = useState(false)
  const searchVisible = !fewSessions || searchForced || !!searchQuery
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Ctrl+F to toggle search — scoped to sidebar (skip when in terminal/forms/modals)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        // Don't intercept when focus is inside an input, textarea, terminal, or modal
        const active = document.activeElement
        if (active && (
          active.tagName === 'TEXTAREA' ||
          (active.tagName === 'INPUT' && active !== searchInputRef.current) ||
          active.closest('.xterm, [role="dialog"]')
        )) return

        e.preventDefault()
        if (fewSessions) {
          setSearchForced(true)
          requestAnimationFrame(() => searchInputRef.current?.focus())
        } else {
          searchInputRef.current?.focus()
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [fewSessions])

  // React to session form requests from WelcomeScreen
  useEffect(() => {
    if (sessionFormRequested) {
      setEditingSession(null)
      setFormOpen(true)
      clearSessionFormRequest()
    }
  }, [sessionFormRequested, clearSessionFormRequest])

  // Auto-expand the group containing the active session.
  // Runs on mount (sidebar uncollapse), when active tab changes, and when sessions change
  // (e.g. a session's group is edited while it's the active tab).
  // INTENTIONALLY excludes expandedGroups and toggleGroup from deps to avoid re-triggering
  // when we ourselves cause a group to expand. The `!expandedGroups.has()` guard reads the
  // current store value at call time, which is safe since Zustand state is always fresh.
  useEffect(() => {
    if (!activeTabId) return
    const activeTab = tabs.find((t) => t.id === activeTabId)
    if (!activeTab) return
    const activeSession = sessions.find((s) => s.id === activeTab.sessionId)
    if (activeSession?.group && !expandedGroups.has(activeSession.group)) {
      toggleGroup(activeSession.group)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, sessions])

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

  // Sort: prefer explicit sortOrder, then creation order, then alphabetical
  const sortedSessions = useMemo(() => {
    return [...filteredSessions].sort((a, b) => {
      const aOrder = a.sortOrder ?? Infinity
      const bOrder = b.sortOrder ?? Infinity
      if (aOrder !== bOrder) return aOrder - bOrder
      const aCreated = a.createdAt ?? 0
      const bCreated = b.createdAt ?? 0
      if (aCreated !== bCreated) return aCreated - bCreated
      return a.name.localeCompare(b.name)
    })
  }, [filteredSessions])

  // Compute flat list of visible sessions (respecting collapsed groups)
  const visibleSessions = useMemo(() => {
    const ungrouped = sortedSessions.filter((s) => !s.group)
    const grouped = new Map<string, Session[]>()
    sortedSessions.filter((s) => s.group).forEach((s) => {
      const g = s.group!
      if (!grouped.has(g)) grouped.set(g, [])
      grouped.get(g)!.push(s)
    })
    const result = [...ungrouped]
    grouped.forEach((sessions, groupName) => {
      if (expandedGroups.has(groupName)) result.push(...sessions)
    })
    return result
  }, [sortedSessions, expandedGroups])

  // Keyboard navigation
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)

  // Reset focused index when visible list changes
  useEffect(() => {
    setFocusedIndex(-1)
  }, [searchQuery, sessions.length, expandedGroups])

  // Scroll focused session into view
  useEffect(() => {
    if (focusedIndex < 0) return
    const session = visibleSessions[focusedIndex]
    if (!session) return
    const el = listRef.current?.querySelector(`[data-session-id="${CSS.escape(session.id)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex, visibleSessions])

  // Drag-to-reorder
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  // Get group of a session by ID
  const getSessionGroup = useCallback(
    (id: string) => sessions.find((s) => s.id === id)?.group ?? null,
    [sessions]
  )

  const handleDragStart = useCallback((sessionId: string, e: React.DragEvent) => {
    setDraggedId(sessionId)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((sessionId: string, e: React.DragEvent) => {
    if (!draggedId || sessionId === draggedId) return
    // Only allow drop within same group
    if (getSessionGroup(draggedId) !== getSessionGroup(sessionId)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverId(sessionId)
  }, [draggedId, getSessionGroup])

  const handleDragLeave = useCallback(() => {
    setDragOverId(null)
  }, [])

  const handleDrop = useCallback((targetId: string) => {
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null)
      setDragOverId(null)
      return
    }
    // Only allow drop within same group
    if (getSessionGroup(draggedId) !== getSessionGroup(targetId)) {
      setDraggedId(null)
      setDragOverId(null)
      return
    }

    // Use the FULL sorted session list (not filtered) to compute new order
    const allSorted = [...sessions].sort((a, b) => {
      const aO = a.sortOrder ?? Infinity
      const bO = b.sortOrder ?? Infinity
      if (aO !== bO) return aO - bO
      const aC = a.createdAt ?? 0
      const bC = b.createdAt ?? 0
      if (aC !== bC) return aC - bC
      return a.name.localeCompare(b.name)
    })
    const ids = allSorted.map((s) => s.id)
    const fromIdx = ids.indexOf(draggedId)
    const toIdx = ids.indexOf(targetId)
    if (fromIdx === -1 || toIdx === -1) return

    ids.splice(fromIdx, 1)
    const insertIdx = ids.indexOf(targetId)
    ids.splice(insertIdx, 0, draggedId)

    reorderSessions(ids)
    setDraggedId(null)
    setDragOverId(null)
  }, [draggedId, sessions, reorderSessions, getSessionGroup])

  const handleDragEnd = useCallback((_e: React.DragEvent) => {
    setDraggedId(null)
    setDragOverId(null)
  }, [])

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

      // Persist new group name if user typed one that doesn't exist yet
      if (data.group && !groups.includes(data.group)) {
        const updated = [...groups, data.group].sort()
        setGroups(updated)
        window.novadeck.sessions.setGroups(updated).catch(() => {})
      }

      setEditingSession(null)
    },
    [editingSession, editSession, createSession, groups]
  )

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    // Clear selected preview if deleting the previewed session
    if (selectedSessionId === deleteTarget.id) setSelectedSessionId(null)
    await deleteSession(deleteTarget.id)
    toast.info('Session deleted', `${deleteTarget.name} has been removed`)
    setDeleteTarget(null)
  }, [deleteTarget, deleteSession, selectedSessionId, setSelectedSessionId])

  const handleDuplicate = useCallback(
    async (id: string) => {
      const dup = await duplicateSession(id)
      if (dup) toast.success('Session duplicated')
    },
    [duplicateSession]
  )

  const handleExport = useCallback(() => {
    setExportDialogOpen(true)
  }, [])

  const handleImport = useCallback(() => {
    setImportDialogOpen(true)
  }, [])



  const getConnectionStatus = (sessionId: string) => {
    const tab = tabs.find((t) => t.sessionId === sessionId)
    return tab?.status
  }

  const isSessionActiveTab = (sessionId: string) => {
    const tab = tabs.find((t) => t.sessionId === sessionId)
    return tab?.id === activeTabId
  }

  const handleDisconnect = useCallback(
    (sessionId: string) => {
      const tab = tabs.find((t) => t.sessionId === sessionId)
      if (tab) {
        window.novadeck.ssh.disconnect?.(tab.id).catch(() => {})
        removeTab(tab.id)
      }
    },
    [tabs, removeTab]
  )

  /** Handle single-click on a disconnected session — switch to its tab or show preview */
  const handleSessionSelect = useCallback(
    (session: Session) => {
      const tab = tabs.find((t) => t.sessionId === session.id)
      if (tab) {
        // Tab exists (even if disconnected) — switch to it
        setActiveTab(tab.id)
        setSelectedSessionId(null)
      } else {
        // No tab — show disconnected session preview
        // Clear activeTabId so the DisconnectedSessionView becomes visible
        setActiveTab(null)
        setSelectedSessionId(session.id)
      }
    },
    [tabs, setActiveTab, setSelectedSessionId]
  )

  /** Whether a session is the currently selected preview (no tab, disconnected) */
  const isSessionSelected = useCallback(
    (sessionId: string) => {
      return selectedSessionId === sessionId && !tabs.find((t) => t.sessionId === sessionId)
    },
    [selectedSessionId, tabs]
  )

  return (
    <>
      {/* New session + actions */}
      <div className="px-3 pt-2 pb-2 shrink-0 flex gap-1.5">
        <Button
          variant="primary"
          size="sm"
          className="flex-1"
          onClick={() => {
            setEditingSession(null)
            setFormOpen(true)
          }}
        >
          <Plus size={14} />
          New Session
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            if (searchVisible && fewSessions) {
              setSearchQuery('')
              setSearchForced(false)
            } else {
              setSearchForced(true)
              requestAnimationFrame(() => searchInputRef.current?.focus())
            }
          }}
          title="Search sessions (Ctrl+F)"
          className={searchVisible ? 'text-nd-accent' : ''}
        >
          <Search size={14} />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleImport} title="Import sessions">
          <Download size={14} />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleExport} title="Export sessions">
          <Upload size={14} />
        </Button>
      </div>

      {/* Search input — appears below buttons when visible */}
      {searchVisible && (
        <div className="px-3 pb-2 shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nd-text-muted" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                if (fewSessions && !searchForced) setSearchForced(true)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchQuery('')
                  setSearchForced(false)
                  searchInputRef.current?.blur()
                }
              }}
              placeholder="Search sessions..."
              className="w-full h-7 pl-8 pr-3 rounded bg-nd-surface border border-nd-border text-xs text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent transition-colors"
            />
          </div>
        </div>
      )}

      {/* Session list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-2 outline-none"
        tabIndex={0}
        onKeyDown={(e) => {
          const len = visibleSessions.length
          if (len === 0) return

          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setFocusedIndex((i) => (i < len - 1 ? i + 1 : 0))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setFocusedIndex((i) => (i > 0 ? i - 1 : len - 1))
          } else if (e.key === 'Enter' && focusedIndex >= 0 && focusedIndex < len) {
            e.preventDefault()
            onConnect(visibleSessions[focusedIndex])
          } else if (e.key === 'Escape') {
            setFocusedIndex(-1)
            listRef.current?.blur()
          }
        }}
      >
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
                isActiveTab={isSessionActiveTab(session.id)}
                isSelected={isSessionSelected(session.id)}
                isFocused={focusedIndex >= 0 && visibleSessions[focusedIndex]?.id === session.id}
                isDragOver={dragOverId === session.id}
                isDragging={draggedId === session.id}
                connectionStatus={getConnectionStatus(session.id)}
                onConnect={() => onConnect(session)}
                onSelect={() => handleSessionSelect(session)}
                onConnectTerminal={() => onConnect(session, 'terminal')}
                onConnectSFTP={() => onConnect(session, 'sftp')}
                onConnectBoth={() => onConnect(session, 'both')}
                onEdit={() => {
                  setEditingSession(session)
                  setFormOpen(true)
                }}
                onDuplicate={() => handleDuplicate(session.id)}
                onDragStart={(e) => handleDragStart(session.id, e)}
                onDragOver={(e) => handleDragOver(session.id, e)}
                onDragLeave={handleDragLeave}
                onDrop={() => handleDrop(session.id)}
                onDragEnd={handleDragEnd}
                onDelete={() => setDeleteTarget(session)}
                onDisconnect={() => handleDisconnect(session.id)}
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
        }}
        session={editingSession}
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

      {/* Export dialog */}
      <ExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
      />

      {/* Import dialog */}
      <ImportDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onComplete={reloadSessions}
      />
    </>
  )
}
