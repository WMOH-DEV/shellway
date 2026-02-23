import { useState, useCallback, useMemo, useRef, useEffect, memo } from 'react'
import { cn } from '@/utils/cn'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import {
  RefreshCw,
  Search,
  ChevronDown,
  ChevronRight,
  Table2,
  Eye,
  AlertCircle
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

// ── Memoized table row ──

interface TableRowProps {
  table: SchemaTable
  isSelected: boolean
  onSelect: (name: string) => void
}

const TableRow = memo(function TableRow({ table, isSelected, onSelect }: TableRowProps) {
  const handleClick = useCallback(() => {
    onSelect(table.name)
  }, [table.name, onSelect])

  const rowCount = formatRowCount(table.rowCount)

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'flex items-center gap-2 w-full px-3 py-1 text-left text-sm',
        'hover:bg-nd-surface-hover transition-colors duration-100 rounded-sm',
        isSelected && 'bg-nd-surface-hover text-nd-text-primary',
        !isSelected && 'text-nd-text-secondary'
      )}
    >
      {table.type === 'view' ? (
        <Eye size={13} className="shrink-0 text-nd-text-muted" />
      ) : (
        <Table2 size={13} className="shrink-0 text-nd-text-muted" />
      )}
      <span className="truncate flex-1">{table.name}</span>
      {rowCount && (
        <span className="text-2xs text-nd-text-muted tabular-nums shrink-0">{rowCount}</span>
      )}
    </button>
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

interface SchemaSidebarProps {
  connectionId: string
}

export function SchemaSidebar({ connectionId }: SchemaSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [fetchError, setFetchError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const handleSelectTable = useCallback(
    (name: string) => {
      setSelectedTable(name)
    },
    [setSelectedTable]
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

  const handleRefresh = useCallback(() => {
    fetchTables()
  }, [fetchTables])

  const handleDatabaseChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newDb = e.target.value
      if (!sqlSessionId || newDb === currentDatabase) return

      setSchemaLoading(true)
      try {
        const result = await window.novadeck.sql.switchDatabase(sqlSessionId, newDb)
        if (result.success) {
          setCurrentDatabase(newDb)
          await fetchTables()
        }
      } catch {
        // Silently fail
      } finally {
        setSchemaLoading(false)
      }
    },
    [sqlSessionId, currentDatabase, setCurrentDatabase, setSchemaLoading, fetchTables]
  )

  return (
    <div className="flex flex-col h-full bg-nd-bg-secondary">
      {/* Database selector + refresh */}
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
                    onSelect={handleSelectTable}
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
                    onSelect={handleSelectTable}
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
