import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FolderPlus,
  Search,
  X
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import type { QueryGroup, SavedQuery } from '@/types/sql'

interface QueriesPanelProps {
  scopeId: string
  onOpenQuery: (sql: string, name: string) => void
}

const UNGROUPED_ID = '__ungrouped__'

const QUERY_MENU: ContextMenuItem[] = [
  { id: 'open', label: 'Open in New Tab' },
  { id: 'copy', label: 'Copy SQL' },
  { id: 'sep', label: '', separator: true },
  { id: 'delete', label: 'Delete', danger: true }
]

const GROUP_MENU: ContextMenuItem[] = [
  { id: 'rename', label: 'Rename…' },
  { id: 'sep', label: '', separator: true },
  { id: 'delete', label: 'Delete Group', danger: true }
]

export function QueriesPanel({ scopeId, onOpenQuery }: QueriesPanelProps) {
  const [queries, setQueries] = useState<SavedQuery[]>([])
  const [groups, setGroups] = useState<QueryGroup[]>([])
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const load = useCallback(() => {
    if (!scopeId) return
    Promise.all([
      window.novadeck.sql.queriesList(scopeId),
      window.novadeck.sql.queryGroupsList(scopeId)
    ])
      .then(([savedQueries, savedGroups]) => {
        setQueries((savedQueries as SavedQuery[]) ?? [])
        setGroups((savedGroups as QueryGroup[]) ?? [])
      })
      .catch(() => {
        setQueries([])
        setGroups([])
      })
  }, [scopeId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const handler = () => load()
    window.addEventListener('sql:queries-changed', handler)
    return () => window.removeEventListener('sql:queries-changed', handler)
  }, [load])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return queries
    return queries.filter(
      (query) =>
        query.name.toLowerCase().includes(term) ||
        query.sql.toLowerCase().includes(term)
    )
  }, [queries, search])

  const sections = useMemo(() => {
    const byGroup = new Map<string, SavedQuery[]>()
    byGroup.set(UNGROUPED_ID, [])
    for (const group of groups) byGroup.set(group.id, [])
    for (const query of filtered) {
      const key = query.groupId ?? UNGROUPED_ID
      if (!byGroup.has(key)) byGroup.set(key, [])
      byGroup.get(key)!.push(query)
    }
    return [
      { id: UNGROUPED_ID, name: 'Ungrouped', queries: byGroup.get(UNGROUPED_ID) ?? [] },
      ...groups.map((group) => ({
        id: group.id,
        name: group.name,
        queries: byGroup.get(group.id) ?? []
      }))
    ]
  }, [filtered, groups])

  const handleToggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleNewGroup = useCallback(() => {
    const name = window.prompt('New group name')
    if (!name?.trim()) return
    window.novadeck.sql.queryGroupCreate(scopeId, name.trim()).then(load).catch(() => {})
  }, [scopeId, load])

  const handleQueryMenu = useCallback(
    (id: string, query: SavedQuery) => {
      if (id === 'open') onOpenQuery(query.sql, query.name)
      if (id === 'copy') navigator.clipboard.writeText(query.sql).catch(() => {})
      if (id === 'delete') {
        if (!window.confirm(`Delete "${query.name}"?`)) return
        window.novadeck.sql.queriesDelete(scopeId, query.id).then(load).catch(() => {})
      }
    },
    [scopeId, load, onOpenQuery]
  )

  const handleGroupMenu = useCallback(
    (id: string, groupId: string, groupName: string) => {
      if (id === 'rename') {
        const name = window.prompt('Rename group', groupName)
        if (!name?.trim()) return
        window.novadeck.sql
          .queryGroupRename(scopeId, groupId, name.trim())
          .then(load)
          .catch(() => {})
      }
      if (id === 'delete') {
        if (!window.confirm(`Delete group "${groupName}"? Its queries move to Ungrouped.`)) {
          return
        }
        window.novadeck.sql.queryGroupDelete(scopeId, groupId).then(load).catch(() => {})
      }
    },
    [scopeId, load]
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1.5 px-2 py-2 border-b border-nd-border shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 rounded-md bg-nd-surface border border-nd-border focus-within:border-nd-accent">
          <Search size={12} className="text-nd-text-muted shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search for query..."
            className="flex-1 min-w-0 bg-transparent text-xs text-nd-text-primary placeholder:text-nd-text-muted outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-nd-text-muted hover:text-nd-text-primary"
            >
              <X size={11} />
            </button>
          )}
        </div>
        <button
          onClick={handleNewGroup}
          title="New group"
          className="p-1.5 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors shrink-0"
        >
          <FolderPlus size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {queries.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-nd-text-muted leading-relaxed">
            No saved queries yet. Select SQL in a query tab and press
            Cmd+Shift+S to save it here.
          </div>
        ) : (
          sections.map((section) => {
            if (section.id === UNGROUPED_ID && section.queries.length === 0) {
              return null
            }
            const isCollapsed = collapsed.has(section.id)
            const header = (
              <button
                onClick={() => handleToggle(section.id)}
                className="flex items-center gap-1 w-full px-2 py-1.5 text-[11px] font-semibold text-nd-text-secondary hover:bg-nd-surface transition-colors"
              >
                {isCollapsed ? (
                  <ChevronRight size={11} />
                ) : (
                  <ChevronDown size={11} />
                )}
                {section.name}
                <span className="text-nd-text-muted font-normal">
                  ({section.queries.length})
                </span>
              </button>
            )

            return (
              <div key={section.id}>
                {section.id === UNGROUPED_ID ? (
                  header
                ) : (
                  <ContextMenu
                    items={GROUP_MENU}
                    onSelect={(id) => handleGroupMenu(id, section.id, section.name)}
                  >
                    {header}
                  </ContextMenu>
                )}

                {!isCollapsed &&
                  section.queries.map((query) => (
                    <ContextMenu
                      key={query.id}
                      items={QUERY_MENU}
                      onSelect={(id) => handleQueryMenu(id, query)}
                    >
                      <button
                        onClick={() => onOpenQuery(query.sql, query.name)}
                        title={query.sql}
                        className={cn(
                          'flex items-center gap-1.5 w-full pl-6 pr-2 py-1.5',
                          'text-xs text-nd-text-primary text-left',
                          'hover:bg-nd-surface transition-colors'
                        )}
                      >
                        <FileCode size={12} className="shrink-0 text-nd-text-muted" />
                        <span className="truncate">{query.name}</span>
                      </button>
                    </ContextMenu>
                  ))}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default QueriesPanel
