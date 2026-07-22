import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/utils/cn'
import {
  SchemaSidebar,
  type DatabaseContextAction,
  type TableContextAction
} from './SchemaSidebar'
import { QueriesPanel } from './QueriesPanel'
import { HistoryPanel } from './HistoryPanel'

type SidebarTab = 'items' | 'queries' | 'history'

const TABS: { value: SidebarTab; label: string }[] = [
  { value: 'items', label: 'Items' },
  { value: 'queries', label: 'Queries' },
  { value: 'history', label: 'History' }
]

interface SQLSidebarProps {
  connectionId: string
  scopeId: string
  currentDatabase: string
  historyRefreshToken: number
  hasSSHConnection?: boolean
  onTableAction?: (action: TableContextAction) => void
  onDatabaseAction?: (action: DatabaseContextAction) => void
  multiSelectedTables?: Set<string>
  onMultiSelectChange?: (tables: Set<string>) => void
  onOpenQuery: (sql: string, name?: string) => void
}

function tabStorageKey(scopeId: string): string {
  return `sql-sidebar-tab:${scopeId}`
}

export function SQLSidebar({
  connectionId,
  scopeId,
  currentDatabase,
  historyRefreshToken,
  hasSSHConnection,
  onTableAction,
  onDatabaseAction,
  multiSelectedTables,
  onMultiSelectChange,
  onOpenQuery
}: SQLSidebarProps) {
  const [tab, setTab] = useState<SidebarTab>('items')

  useEffect(() => {
    if (!scopeId) return
    try {
      const saved = localStorage.getItem(tabStorageKey(scopeId))
      if (saved === 'items' || saved === 'queries' || saved === 'history') {
        setTab(saved)
      }
    } catch {
      /* storage unavailable */
    }
  }, [scopeId])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail === 'items' || detail === 'queries' || detail === 'history') {
        setTab(detail)
      }
    }
    window.addEventListener('sql:sidebar-tab', handler)
    return () => window.removeEventListener('sql:sidebar-tab', handler)
  }, [])

  const handleSelectTab = useCallback(
    (value: SidebarTab) => {
      setTab(value)
      try {
        localStorage.setItem(tabStorageKey(scopeId), value)
      } catch {
        /* storage unavailable */
      }
    },
    [scopeId]
  )

  return (
    <div className="flex flex-col h-full bg-nd-bg-secondary">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-nd-border shrink-0">
        {TABS.map((entry) => (
          <button
            key={entry.value}
            onClick={() => handleSelectTab(entry.value)}
            className={cn(
              'flex-1 px-2 py-1 rounded text-xs font-medium transition-colors',
              tab === entry.value
                ? 'bg-nd-surface text-nd-text-primary'
                : 'text-nd-text-muted hover:text-nd-text-secondary'
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className={cn('flex-1 min-h-0', tab !== 'items' && 'hidden')}>
        <SchemaSidebar
          connectionId={connectionId}
          hasSSHConnection={hasSSHConnection}
          onTableAction={onTableAction}
          onDatabaseAction={onDatabaseAction}
          multiSelectedTables={multiSelectedTables}
          onMultiSelectChange={onMultiSelectChange}
        />
      </div>

      {tab === 'queries' && (
        <div className="flex-1 min-h-0">
          <QueriesPanel scopeId={scopeId} onOpenQuery={onOpenQuery} />
        </div>
      )}

      {tab === 'history' && (
        <div className="flex-1 min-h-0">
          <HistoryPanel
            scopeId={scopeId}
            currentDatabase={currentDatabase}
            refreshToken={historyRefreshToken}
            onOpenQuery={onOpenQuery}
          />
        </div>
      )}
    </div>
  )
}
