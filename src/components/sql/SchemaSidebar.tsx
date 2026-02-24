import { useState, useCallback, useMemo, useRef, useEffect, memo } from 'react'
import { cn } from '@/utils/cn'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import {
  RefreshCw,
  Search,
  ChevronDown,
  ChevronRight,
  Table2,
  Eye,
  AlertCircle,
  Download,
  Upload,
  Copy,
  Trash2,
  FileText,
  FileJson,
  Database,
  HardDrive,
  RotateCcw,
  Plus,
  Columns3,
} from 'lucide-react'
import { useSQLConnection } from '@/stores/sqlStore'
import type { SchemaTable } from '@/types/sql'

// ── Row count formatter ──

function formatRowCount(count: number | undefined): string {
  if (count == null) return ''
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}k`
  return String(count)
}

// ── Table context menu items builder ──

function buildTableContextMenuItems(
  tableName: string,
  isView: boolean,
  multiSelectedCount: number
): ContextMenuItem[] {
  return [
    // Multi-selection export options (shown when table is part of a multi-select)
    ...(multiSelectedCount > 1
      ? [
          {
            id: 'export-selected:sql',
            label: `Export ${multiSelectedCount} Selected as SQL`,
            icon: <Database size={14} />,
          },
          {
            id: 'export-selected:csv',
            label: `Export ${multiSelectedCount} Selected as CSV`,
            icon: <FileText size={14} />,
          },
          {
            id: 'export-selected:json',
            label: `Export ${multiSelectedCount} Selected as JSON`,
            icon: <FileJson size={14} />,
          },
          { id: 'sep-multi', label: '', separator: true },
        ]
      : []),
    ...(isView
      ? []
      : [
          {
            id: `structure:${tableName}`,
            label: 'View Structure',
            icon: <Columns3 size={14} />,
          },
          { id: 'sep-0', label: '', separator: true },
        ]),
    { id: `export:csv:${tableName}`, label: 'Export as CSV', icon: <FileText size={14} /> },
    { id: `export:json:${tableName}`, label: 'Export as JSON', icon: <FileJson size={14} /> },
    { id: `export:sql:${tableName}`, label: 'Export as SQL', icon: <Database size={14} /> },
    { id: 'sep-1', label: '', separator: true },
    ...(isView
      ? []
      : [
          {
            id: `import:csv:${tableName}`,
            label: 'Import from CSV',
            icon: <Upload size={14} />,
          },
          { id: 'sep-2', label: '', separator: true },
        ]),
    { id: `copy:${tableName}`, label: 'Copy Table Name', icon: <Copy size={14} /> },
    ...(isView
      ? []
      : [
          { id: 'sep-3', label: '', separator: true },
          {
            id: `truncate:${tableName}`,
            label: 'Truncate Table',
            icon: <Trash2 size={14} />,
            danger: true,
          },
          {
            id: `drop:${tableName}`,
            label: 'Drop Table',
            icon: <Trash2 size={14} />,
            danger: true,
          },
        ]),
  ]
}

// ── Database context menu items builder ──

function buildDatabaseContextMenuItems(hasSSH: boolean): ContextMenuItem[] {
  return [
    { id: 'db:export', label: 'Export Database', icon: <Download size={14} /> },
    { id: 'db:import-sql', label: 'Import SQL Dump', icon: <Upload size={14} /> },
    { id: 'sep-1', label: '', separator: true },
    { id: 'db:backup', label: 'Backup Database', icon: <HardDrive size={14} />, disabled: !hasSSH },
    { id: 'db:restore', label: 'Restore Database', icon: <RotateCcw size={14} />, disabled: !hasSSH },
    { id: 'sep-2', label: '', separator: true },
    { id: 'db:create', label: 'Create New Database', icon: <Plus size={14} /> },
  ]
}

// ── Memoized table row ──

interface TableRowProps {
  table: SchemaTable
  isSelected: boolean
  isMultiSelected: boolean
  multiSelectedCount: number
  onSelect: (name: string, e?: React.MouseEvent | React.KeyboardEvent) => void
  onContextMenuSelect: (id: string) => void
}

const TableRow = memo(function TableRow({
  table,
  isSelected,
  isMultiSelected,
  multiSelectedCount,
  onSelect,
  onContextMenuSelect,
}: TableRowProps) {
  const handleClick = useCallback((e: React.MouseEvent) => {
    onSelect(table.name, e)
  }, [table.name, onSelect])

  const handleExport = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onContextMenuSelect(`export:sql:${table.name}`)
  }, [table.name, onContextMenuSelect])

  const handleImportCSV = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onContextMenuSelect(`import:csv:${table.name}`)
  }, [table.name, onContextMenuSelect])

  const rowCount = formatRowCount(table.rowCount)
  const isView = table.type === 'view'

  // Show multi-select count only if this table is part of the selection
  const effectiveMultiCount = isMultiSelected ? multiSelectedCount : 0

  const contextMenuItems = useMemo(
    () => buildTableContextMenuItems(table.name, isView, effectiveMultiCount),
    [table.name, isView, effectiveMultiCount]
  )

  return (
    <ContextMenu items={contextMenuItems} onSelect={onContextMenuSelect}>
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(table.name, e) }}
        className={cn(
          'group flex items-center gap-2 w-full px-3 py-1 text-left text-sm',
          'hover:bg-nd-surface-hover transition-colors duration-100 rounded-sm cursor-pointer',
          isMultiSelected && 'bg-nd-accent/15 text-nd-accent',
          isSelected && !isMultiSelected && 'bg-nd-surface-hover text-nd-text-primary',
          !isSelected && !isMultiSelected && 'text-nd-text-secondary'
        )}
      >
        {table.type === 'view' ? (
          <Eye size={13} className="shrink-0 text-nd-text-muted" />
        ) : (
          <Table2 size={13} className="shrink-0 text-nd-text-muted" />
        )}
        <span className="truncate flex-1">{table.name}</span>

        {/* Hover action buttons */}
        <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={handleExport}
            title={`Export ${table.name}`}
            className="p-0.5 rounded text-nd-text-muted hover:text-nd-accent transition-colors"
          >
            <Download size={11} />
          </button>
          {!isView && (
            <button
              type="button"
              onClick={handleImportCSV}
              title={`Import CSV into ${table.name}`}
              className="p-0.5 rounded text-nd-text-muted hover:text-nd-accent transition-colors"
            >
              <Upload size={11} />
            </button>
          )}
        </span>

        {/* Row count (hidden on hover to make room for actions) */}
        {rowCount && (
          <span className="text-2xs text-nd-text-muted tabular-nums shrink-0 group-hover:hidden">{rowCount}</span>
        )}
      </div>
    </ContextMenu>
  )
})

// ── Collapsible group ──

interface GroupProps {
  label: string
  count: number
  defaultOpen?: boolean
  children: React.ReactNode
}

function Group({ label, count, defaultOpen = true, children }: GroupProps) {
  const [open, setOpen] = useState(defaultOpen)

  const toggle = useCallback(() => setOpen((prev) => !prev), [])

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-medium text-nd-text-muted hover:text-nd-text-secondary transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{label}</span>
        <span className="text-2xs ml-auto tabular-nums">({count})</span>
      </button>
      {open && <div className="flex flex-col">{children}</div>}
    </div>
  )
}

// ── Main sidebar ──

/** Context menu action type for table actions */
export type TableContextAction =
  | { type: 'export'; table: string; format: 'csv' | 'json' | 'sql' }
  | { type: 'export-selected'; tables: string[]; format: 'csv' | 'json' | 'sql' }
  | { type: 'import-csv'; table: string }
  | { type: 'copy-name'; table: string }
  | { type: 'drop-table'; table: string }
  | { type: 'truncate-table'; table: string }
  | { type: 'view-structure'; table: string }

/** Context menu action type for database actions */
export type DatabaseContextAction =
  | { type: 'export-database' }
  | { type: 'import-sql' }
  | { type: 'backup' }
  | { type: 'restore' }
  | { type: 'create-database' }

interface SchemaSidebarProps {
  connectionId: string
  /** Whether an SSH connection is available (enables backup/restore) */
  hasSSHConnection?: boolean
  /** Callback for table context menu actions */
  onTableAction?: (action: TableContextAction) => void
  /** Callback for database context menu actions */
  onDatabaseAction?: (action: DatabaseContextAction) => void
  /** Currently multi-selected tables (controlled from parent) */
  multiSelectedTables?: Set<string>
  /** Called when multi-selection changes */
  onMultiSelectChange?: (tables: Set<string>) => void
}

export function SchemaSidebar({
  connectionId,
  hasSSHConnection = false,
  onTableAction,
  onDatabaseAction,
  multiSelectedTables,
  onMultiSelectChange,
}: SchemaSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [fetchError, setFetchError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Internal multi-selection state (used when not controlled by parent)
  const [internalMultiSelected, setInternalMultiSelected] = useState<Set<string>>(new Set())
  const multiSelected = multiSelectedTables ?? internalMultiSelected

  // Ref for current controlled value — avoids stale closures in the setter
  const multiSelectedTablesRef = useRef(multiSelectedTables)
  multiSelectedTablesRef.current = multiSelectedTables

  const setMultiSelected = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      if (onMultiSelectChange) {
        const next = typeof updater === 'function'
          ? updater(multiSelectedTablesRef.current ?? new Set())
          : updater
        onMultiSelectChange(next)
      } else {
        if (typeof updater === 'function') {
          setInternalMultiSelected((prev) => updater(prev))
        } else {
          setInternalMultiSelected(updater)
        }
      }
    },
    [onMultiSelectChange]
  )

  // Track last clicked table for shift-click range selection
  const lastClickedRef = useRef<string | null>(null)

  // Ref for multi-selected state — avoids recreating handleSelectTable on every selection change
  const multiSelectedRef = useRef(multiSelected)
  multiSelectedRef.current = multiSelected

  const {
    databases,
    tables,
    selectedTable,
    currentDatabase,
    connectionConfig,
    schemaLoading,
    sqlSessionId,
    setSelectedTable,
    setTables,
    setDatabases,
    setCurrentDatabase,
    setSchemaLoading,
  } = useSQLConnection(connectionId)

  const isPostgres = connectionConfig?.type === 'postgres'

  // Debounced search
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setSearchQuery(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        setDebouncedSearch(value)
      }, 300)
    },
    []
  )

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // Filtered & grouped tables
  const { filteredTables, filteredViews } = useMemo(() => {
    const search = debouncedSearch.toLowerCase()
    const matched = search
      ? tables.filter((t) => t.name.toLowerCase().includes(search))
      : tables

    return {
      filteredTables: matched.filter((t) => t.type === 'table'),
      filteredViews: matched.filter((t) => t.type === 'view')
    }
  }, [tables, debouncedSearch])

  // Database options for selector
  const databaseOptions = useMemo(
    () => databases.map((db) => ({ value: db.name, label: db.name })),
    [databases]
  )

  // Flat ordered list of all visible table names (tables first, then views)
  const orderedTableNames = useMemo(
    () => [...filteredTables, ...filteredViews].map((t) => t.name),
    [filteredTables, filteredViews]
  )

  const handleSelectTable = useCallback(
    (name: string, e?: React.MouseEvent | React.KeyboardEvent) => {
      const isCtrlOrCmd = e && (e.metaKey || e.ctrlKey)
      const isShift = e && e.shiftKey

      if (isCtrlOrCmd) {
        // Toggle individual table in multi-selection
        setMultiSelected((prev) => {
          const next = new Set(prev)
          if (next.has(name)) {
            next.delete(name)
          } else {
            next.add(name)
          }
          return next
        })
        lastClickedRef.current = name
        return
      }

      if (isShift && lastClickedRef.current) {
        // Range selection
        const startIdx = orderedTableNames.indexOf(lastClickedRef.current)
        const endIdx = orderedTableNames.indexOf(name)
        if (startIdx !== -1 && endIdx !== -1) {
          const [low, high] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
          const rangeNames = orderedTableNames.slice(low, high + 1)
          setMultiSelected((prev) => {
            const next = new Set(prev)
            for (const n of rangeNames) next.add(n)
            return next
          })
        }
        return
      }

      // Normal click — single select, clear multi-selection
      if (multiSelectedRef.current.size > 0) {
        setMultiSelected(new Set())
      }
      setSelectedTable(name)
      lastClickedRef.current = name
    },
    [setSelectedTable, setMultiSelected, orderedTableNames]
  )

  // ── Context menu handlers ──

  const handleTableContextMenuSelect = useCallback(
    (id: string) => {
      if (!onTableAction) return

      // Multi-selection export actions
      if (id.startsWith('export-selected:')) {
        const format = id.slice('export-selected:'.length) as 'csv' | 'json' | 'sql'
        const selectedNames = Array.from(multiSelected)
        onTableAction({ type: 'export-selected', tables: selectedNames, format })
        return
      }

      // Parse action: "type:value:tableName" or "copy:tableName"
      if (id.startsWith('structure:')) {
        onTableAction({ type: 'view-structure', table: id.slice('structure:'.length) })
      } else if (id.startsWith('export:csv:')) {
        onTableAction({ type: 'export', table: id.slice('export:csv:'.length), format: 'csv' })
      } else if (id.startsWith('export:json:')) {
        onTableAction({ type: 'export', table: id.slice('export:json:'.length), format: 'json' })
      } else if (id.startsWith('export:sql:')) {
        onTableAction({ type: 'export', table: id.slice('export:sql:'.length), format: 'sql' })
      } else if (id.startsWith('import:csv:')) {
        onTableAction({ type: 'import-csv', table: id.slice('import:csv:'.length) })
      } else if (id.startsWith('copy:')) {
        const tableName = id.slice('copy:'.length)
        navigator.clipboard.writeText(tableName).catch(() => {})
        onTableAction({ type: 'copy-name', table: tableName })
      } else if (id.startsWith('drop:')) {
        onTableAction({ type: 'drop-table', table: id.slice('drop:'.length) })
      } else if (id.startsWith('truncate:')) {
        onTableAction({ type: 'truncate-table', table: id.slice('truncate:'.length) })
      }
    },
    [onTableAction, multiSelected]
  )

  const handleDatabaseContextMenuSelect = useCallback(
    (id: string) => {
      if (!onDatabaseAction) return

      switch (id) {
        case 'db:export':
          onDatabaseAction({ type: 'export-database' })
          break
        case 'db:import-sql':
          onDatabaseAction({ type: 'import-sql' })
          break
        case 'db:backup':
          onDatabaseAction({ type: 'backup' })
          break
        case 'db:restore':
          onDatabaseAction({ type: 'restore' })
          break
        case 'db:create':
          onDatabaseAction({ type: 'create-database' })
          break
      }
    },
    [onDatabaseAction]
  )

  const dbContextMenuItems = useMemo(
    () => buildDatabaseContextMenuItems(hasSSHConnection),
    [hasSSHConnection]
  )

  const fetchTables = useCallback(async () => {
    if (!sqlSessionId) return
    setSchemaLoading(true)
    setFetchError(null)
    try {
      const result = await window.novadeck.sql.getTables(sqlSessionId)
      if (result.success && result.data) {
        setTables(result.data)
      } else {
        setFetchError(result.error ?? 'Failed to load tables')
      }
    } catch (err: any) {
      setFetchError(err?.message ?? 'Failed to load tables')
    } finally {
      setSchemaLoading(false)
    }
  }, [sqlSessionId, setTables, setSchemaLoading])

  const fetchDatabases = useCallback(async () => {
    if (!sqlSessionId) return
    try {
      const result = await window.novadeck.sql.getDatabases(sqlSessionId)
      if (result.success && result.data) {
        setDatabases(
          result.data.map((name: string) => ({
            name,
            isActive: name === currentDatabase
          }))
        )
      }
    } catch {
      // Silently fail
    }
  }, [sqlSessionId, currentDatabase, setDatabases])

  // Fetch tables + databases on mount (only if not already loaded)
  const hasFetchedRef = useRef(false)
  useEffect(() => {
    if (hasFetchedRef.current) return
    hasFetchedRef.current = true
    fetchTables()
    fetchDatabases()
  }, [fetchTables, fetchDatabases])

  // Re-fetch tables when currentDatabase changes (e.g., after switching databases via picker)
  const prevDatabaseRef = useRef(currentDatabase)
  useEffect(() => {
    if (prevDatabaseRef.current !== currentDatabase && currentDatabase) {
      prevDatabaseRef.current = currentDatabase
      fetchTables()
      fetchDatabases()
    }
  }, [currentDatabase, fetchTables, fetchDatabases])

  const handleRefresh = useCallback(() => {
    fetchTables()
  }, [fetchTables])

  const handleDatabaseChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newDb = e.target.value
      if (!sqlSessionId || newDb === currentDatabase) return

      try {
        const result = await window.novadeck.sql.switchDatabase(sqlSessionId, newDb)
        if (result.success) {
          setCurrentDatabase(newDb)
          // Tables are auto-refreshed by the currentDatabase change effect below
        }
      } catch {
        // Silently fail
      }
    },
    [sqlSessionId, currentDatabase, setCurrentDatabase]
  )

  return (
    <div className="flex flex-col h-full bg-nd-bg-secondary">
      {/* Database selector + refresh */}
      <ContextMenu items={dbContextMenuItems} onSelect={handleDatabaseContextMenuSelect}>
        <div className="flex items-center gap-1.5 px-2 py-2 border-b border-nd-border">
          <div className="flex-1 min-w-0">
            {isPostgres ? (
              // Postgres doesn't support switching databases on the same connection
              <div className="flex items-center h-7 px-2 text-xs text-nd-text-secondary bg-nd-surface rounded border border-nd-border truncate">
                {currentDatabase}
              </div>
            ) : (
              <Select
                options={databaseOptions}
                value={currentDatabase}
                onChange={handleDatabaseChange}
                className="!h-7 text-xs"
              />
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={schemaLoading}
            className="shrink-0 !h-7 !w-7"
            title="Refresh schema"
          >
            <RefreshCw size={13} className={cn(schemaLoading && 'animate-spin')} />
          </Button>
        </div>
      </ContextMenu>

      {/* Search */}
      <div className="px-2 py-2 border-b border-nd-border">
        <Input
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder="Search tables..."
          icon={<Search size={13} />}
          className="!h-7 text-xs"
        />
      </div>

      {/* Database actions toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-nd-border">
        <button
          onClick={() => onDatabaseAction?.({ type: 'export-database' })}
          title={multiSelected.size > 0 ? `Export ${multiSelected.size} selected tables` : 'Export Database'}
          className={cn(
            'flex items-center gap-1 px-1.5 py-1 rounded text-2xs transition-colors',
            multiSelected.size > 0
              ? 'text-nd-accent hover:text-nd-accent hover:bg-nd-accent/10'
              : 'text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface-hover'
          )}
        >
          <Download size={12} />
          <span>Export{multiSelected.size > 0 ? ` (${multiSelected.size})` : ''}</span>
        </button>
        <button
          onClick={() => onDatabaseAction?.({ type: 'import-sql' })}
          title="Import SQL"
          className="flex items-center gap-1 px-1.5 py-1 rounded text-2xs text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface-hover transition-colors"
        >
          <Upload size={12} />
          <span>Import</span>
        </button>
        <button
          onClick={() => onDatabaseAction?.({ type: 'backup' })}
          title="Backup via SSH"
          disabled={!hasSSHConnection}
          className={cn(
            'flex items-center gap-1 px-1.5 py-1 rounded text-2xs transition-colors',
            hasSSHConnection
              ? 'text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface-hover'
              : 'text-nd-text-muted/40 cursor-not-allowed'
          )}
        >
          <HardDrive size={12} />
          <span>Backup</span>
        </button>
        <button
          onClick={() => onDatabaseAction?.({ type: 'restore' })}
          title="Restore via SSH"
          disabled={!hasSSHConnection}
          className={cn(
            'flex items-center gap-1 px-1.5 py-1 rounded text-2xs transition-colors',
            hasSSHConnection
              ? 'text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface-hover'
              : 'text-nd-text-muted/40 cursor-not-allowed'
          )}
        >
          <RotateCcw size={12} />
          <span>Restore</span>
        </button>
      </div>

      {/* Table list */}
      <div className="flex-1 overflow-y-auto py-1">
        {fetchError && tables.length === 0 ? (
          <div className="px-3 py-6 text-center space-y-2">
            <AlertCircle size={20} className="mx-auto text-nd-error" />
            <p className="text-xs text-nd-error">{fetchError}</p>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={handleRefresh}
            >
              <RefreshCw size={12} />
              Retry
            </Button>
          </div>
        ) : schemaLoading && tables.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-4 h-4 rounded-full border-2 border-nd-accent border-t-transparent" />
          </div>
        ) : tables.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-nd-text-muted">No tables found</p>
          </div>
        ) : (
          <>
            {filteredTables.length > 0 && (
              <Group label="Tables" count={filteredTables.length}>
                {filteredTables.map((table) => (
                  <TableRow
                    key={table.name}
                    table={table}
                    isSelected={selectedTable === table.name}
                    isMultiSelected={multiSelected.has(table.name)}
                    multiSelectedCount={multiSelected.size}
                    onSelect={handleSelectTable}
                    onContextMenuSelect={handleTableContextMenuSelect}
                  />
                ))}
              </Group>
            )}

            {filteredViews.length > 0 && (
              <Group label="Views" count={filteredViews.length} defaultOpen={filteredTables.length === 0}>
                {filteredViews.map((table) => (
                  <TableRow
                    key={table.name}
                    table={table}
                    isSelected={selectedTable === table.name}
                    isMultiSelected={multiSelected.has(table.name)}
                    multiSelectedCount={multiSelected.size}
                    onSelect={handleSelectTable}
                    onContextMenuSelect={handleTableContextMenuSelect}
                  />
                ))}
              </Group>
            )}

            {filteredTables.length === 0 && filteredViews.length === 0 && debouncedSearch && (
              <div className="px-3 py-6 text-center">
                <p className="text-xs text-nd-text-muted">No matches for "{debouncedSearch}"</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
