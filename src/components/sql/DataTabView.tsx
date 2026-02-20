import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import { DataGrid } from '@/components/sql/DataGrid'
import { PaginationBar } from '@/components/sql/PaginationBar'
import { FilterBar } from '@/components/sql/FilterBar'
import { buildWhereClause } from '@/utils/sqlFilterBuilder'
import { useSQLConnection } from '@/stores/sqlStore'
import type {
  DatabaseType,
  PaginationState,
  QueryResult,
  QueryField,
  TableFilter,
  StagedChange,
  SchemaColumn,
} from '@/types/sql'

// ── Props ──

interface DataTabViewProps {
  connectionId: string
  sqlSessionId: string
  table: string
  schema?: string
  dbType: DatabaseType
}

// ── Helpers ──

function quoteIdentifier(name: string, dbType: DatabaseType): string {
  if (dbType === 'mysql') return `\`${name.replace(/`/g, '``')}\``
  return `"${name.replace(/"/g, '""')}"`
}

function buildFullTableName(
  table: string,
  schema: string | undefined,
  dbType: DatabaseType
): string {
  const quotedTable = quoteIdentifier(table, dbType)
  if (schema) return `${quoteIdentifier(schema, dbType)}.${quotedTable}`
  return quotedTable
}

function buildDataQuery(opts: {
  table: string
  schema?: string
  dbType: DatabaseType
  page: number
  pageSize: number
  sortColumn?: string
  sortDirection?: 'asc' | 'desc'
  filters: TableFilter[]
}): { query: string; params: unknown[] } {
  const { table, schema, dbType, page, pageSize, sortColumn, sortDirection, filters } =
    opts

  const fullTable = buildFullTableName(table, schema, dbType)
  const { where, params } = buildWhereClause(filters, dbType)

  let query = `SELECT * FROM ${fullTable}`

  if (where) {
    query += ` ${where}`
  }

  if (sortColumn) {
    const quotedCol = quoteIdentifier(sortColumn, dbType)
    query += ` ORDER BY ${quotedCol} ${sortDirection ?? 'asc'}`
  }

  const offset = (page - 1) * pageSize
  if (dbType === 'mysql') {
    // MySQL uses ? placeholders — append as params for safety
    query += ` LIMIT ? OFFSET ?`
    params.push(pageSize, offset)
  } else {
    // Postgres — use parameterized limit/offset appended after WHERE params
    const limitIdx = params.length + 1
    const offsetIdx = params.length + 2
    query += ` LIMIT $${limitIdx} OFFSET $${offsetIdx}`
    params.push(pageSize, offset)
  }

  return { query, params }
}

function buildCountQuery(
  table: string,
  schema: string | undefined,
  dbType: DatabaseType,
  filters: TableFilter[]
): { query: string; params: unknown[] } {
  const fullTable = buildFullTableName(table, schema, dbType)
  const { where, params } = buildWhereClause(filters, dbType)
  let query = `SELECT COUNT(*) AS count FROM ${fullTable}`
  if (where) query += ` ${where}`
  return { query, params }
}

// ── Primary key extraction ──

/**
 * Build a primaryKey record from a row using known PK columns.
 * Falls back to using the entire row as identity if no PKs are known.
 */
function buildPrimaryKey(
  row: Record<string, unknown>,
  pkColumns: string[]
): Record<string, unknown> {
  if (pkColumns.length === 0) {
    // No primary key — use entire row as WHERE clause (risky but functional)
    return { ...row }
  }
  const pk: Record<string, unknown> = {}
  for (const col of pkColumns) {
    pk[col] = row[col]
  }
  return pk
}

// ── Default state ──

const DEFAULT_PAGE_SIZE = 200
const FILTER_DEBOUNCE_MS = 500

function defaultPagination(): PaginationState {
  return { page: 1, pageSize: DEFAULT_PAGE_SIZE, totalRows: 0, totalPages: 0 }
}

// ── Component ──

export const DataTabView = React.memo(function DataTabView({
  connectionId,
  sqlSessionId,
  table,
  schema,
  dbType,
}: DataTabViewProps) {
  // State
  const [result, setResult] = useState<QueryResult | null>(null)
  const [columns, setColumns] = useState<QueryField[]>([])
  const [pagination, setPagination] = useState<PaginationState>(defaultPagination)
  const [sortColumn, setSortColumn] = useState<string | undefined>()
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [filters, setFilters] = useState<TableFilter[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [executionTimeMs, setExecutionTimeMs] = useState<number | undefined>()
  const [primaryKeyColumns, setPrimaryKeyColumns] = useState<string[]>([])
  const [columnMeta, setColumnMeta] = useState<SchemaColumn[]>([])

  // Refs for cancellation, debouncing, and race condition prevention
  const abortRef = useRef<AbortController | null>(null)
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queryIdRef = useRef(0)

  // Cache key to avoid re-fetching when switching back to a loaded tab
  const cacheKeyRef = useRef<string>('')
  const resultRef = useRef<QueryResult | null>(null)

  // ── Query execution ──

  const executeQuery = useCallback(
    async (opts: {
      page: number
      pageSize: number
      sort?: string
      sortDir?: 'asc' | 'desc'
      currentFilters: TableFilter[]
      skipIfCached?: boolean
    }) => {
      const { page, pageSize, sort, sortDir, currentFilters, skipIfCached } = opts

      // Build a cache key
      const key = JSON.stringify({ table, schema, page, pageSize, sort, sortDir, currentFilters })
      if (skipIfCached && key === cacheKeyRef.current && resultRef.current) {
        return // already loaded
      }

      // Cancel any in-flight query and track this query's ID
      if (abortRef.current) {
        abortRef.current.abort()
      }
      const controller = new AbortController()
      abortRef.current = controller
      const thisQueryId = ++queryIdRef.current

      setIsLoading(true)
      setError(null)

      try {
        // Build and execute data query
        const { query, params } = buildDataQuery({
          table,
          schema,
          dbType,
          page,
          pageSize,
          sortColumn: sort,
          sortDirection: sortDir,
          filters: currentFilters,
        })

        // Check if this query is still current
        if (controller.signal.aborted || thisQueryId !== queryIdRef.current) return

        const queryResponse = await (window as any).novadeck.sql.query(
          sqlSessionId,
          query,
          params
        )

        // Check again after async call
        if (controller.signal.aborted || thisQueryId !== queryIdRef.current) return

        // Unwrap IPC envelope { success, data, error }
        if (!queryResponse.success) {
          throw new Error(queryResponse.error ?? 'Query failed')
        }
        const queryResult: QueryResult = queryResponse.data

        setResult(queryResult)
        resultRef.current = queryResult
        setExecutionTimeMs(queryResult.executionTimeMs)
        cacheKeyRef.current = key

        // Set columns from first result
        if (queryResult.fields && queryResult.fields.length > 0) {
          setColumns(queryResult.fields)
        }

        // Fetch row count if we don't have it yet or filters changed
        const { query: countQuery, params: countParams } = buildCountQuery(
          table,
          schema,
          dbType,
          currentFilters
        )

        if (controller.signal.aborted || thisQueryId !== queryIdRef.current) return

        const countResponse = await (window as any).novadeck.sql.query(
          sqlSessionId,
          countQuery,
          countParams
        )

        if (controller.signal.aborted || thisQueryId !== queryIdRef.current) return

        if (!countResponse.success) {
          throw new Error(countResponse.error ?? 'Count query failed')
        }
        const countResult: QueryResult = countResponse.data

        const totalRows =
          Number((countResult.rows[0] as any)?.count ?? 0)
        const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))

        setPagination({ page, pageSize, totalRows, totalPages })
      } catch (err: any) {
        if (controller.signal.aborted || thisQueryId !== queryIdRef.current) return
        setError(err?.message ?? 'Query failed')
      } finally {
        if (!controller.signal.aborted && thisQueryId === queryIdRef.current) {
          setIsLoading(false)
        }
      }
    },
    [table, schema, dbType, sqlSessionId]
  )

  // ── Initial load ──

  useEffect(() => {
    setPagination(defaultPagination())
    setSortColumn(undefined)
    setSortDirection('asc')
    setFilters([])
    setResult(null)
    resultRef.current = null
    setError(null)
    setPrimaryKeyColumns([])
    cacheKeyRef.current = ''

    executeQuery({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      currentFilters: [],
    })

    // Fetch column metadata (primary keys + auto-increment info) for inline editing
    ;(async () => {
      try {
        const res = await (window as any).novadeck.sql.getColumns(sqlSessionId, table, schema)
        if (res?.success && Array.isArray(res.data)) {
          setColumnMeta(res.data)
          const pkCols = res.data
            .filter((c: any) => c.isPrimaryKey)
            .map((c: any) => c.name)
          setPrimaryKeyColumns(pkCols)
        }
      } catch {
        // Non-critical — inline editing will fall back to full-row WHERE
      }
    })()

    return () => {
      abortRef.current?.abort()
      if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current)
    }
  }, [table, schema, connectionId, sqlSessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──

  const handlePageChange = useCallback(
    (page: number) => {
      setPagination((prev) => ({ ...prev, page }))
      executeQuery({
        page,
        pageSize: pagination.pageSize,
        sort: sortColumn,
        sortDir: sortDirection,
        currentFilters: filters,
      })
    },
    [executeQuery, pagination.pageSize, sortColumn, sortDirection, filters]
  )

  const handlePageSizeChange = useCallback(
    (pageSize: number) => {
      setPagination((prev) => ({
        ...prev,
        pageSize,
        page: 1,
        totalPages: Math.max(1, Math.ceil(prev.totalRows / pageSize)),
      }))
      executeQuery({
        page: 1,
        pageSize,
        sort: sortColumn,
        sortDir: sortDirection,
        currentFilters: filters,
      })
    },
    [executeQuery, sortColumn, sortDirection, filters]
  )

  const handleSort = useCallback(
    (column: string, direction: 'asc' | 'desc') => {
      setSortColumn(column)
      setSortDirection(direction)
      executeQuery({
        page: 1,
        pageSize: pagination.pageSize,
        sort: column,
        sortDir: direction,
        currentFilters: filters,
      })
    },
    [executeQuery, pagination.pageSize, filters]
  )

  // Ref always holds latest filters so debounced callbacks never use stale state
  const filtersRef = useRef<TableFilter[]>(filters)

  const handleFiltersChange = useCallback((newFilters: TableFilter[]) => {
    filtersRef.current = newFilters
    setFilters(newFilters)
  }, [])

  const handleFiltersApply = useCallback(() => {
    // Debounce filter application — reads filtersRef to avoid stale closures
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current)
    filterDebounceRef.current = setTimeout(() => {
      setPagination((prev) => ({ ...prev, page: 1 }))
      executeQuery({
        page: 1,
        pageSize: pagination.pageSize,
        sort: sortColumn,
        sortDir: sortDirection,
        currentFilters: filtersRef.current,
      })
    }, FILTER_DEBOUNCE_MS)
  }, [executeQuery, pagination.pageSize, sortColumn, sortDirection])

  // ── Inline editing → staged changes ──
  const { addStagedChange } = useSQLConnection(connectionId)

  const handleCellEdit = useCallback(
    (rowIndex: number, field: string, oldValue: unknown, newValue: unknown) => {
      if (oldValue === newValue) return

      const row = result?.rows[rowIndex]
      if (!row) return

      const rowData = row as Record<string, unknown>
      const change: StagedChange = {
        id: `edit-${table}-${rowIndex}-${field}-${Date.now()}`,
        type: 'update',
        table,
        schema,
        primaryKey: buildPrimaryKey(rowData, primaryKeyColumns),
        changes: { [field]: { old: oldValue, new: newValue } },
        rowData,
        column: field,
        oldValue,
        newValue,
      }
      addStagedChange(change)
    },
    [result, table, schema, primaryKeyColumns, addStagedChange]
  )

  // Memoize columns for FilterBar
  const filterColumns = useMemo(() => columns, [columns])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Filter Bar */}
      <FilterBar
        filters={filters}
        columns={filterColumns}
        onFiltersChange={handleFiltersChange}
        onApply={handleFiltersApply}
      />

      {/* Error banner */}
      {error && (
        <div className="shrink-0 border-b border-nd-error/30 bg-nd-error/10 px-3 py-1.5 text-xs text-nd-error">
          {error}
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <div className="absolute right-3 top-3 z-10">
          <Loader2 size={16} className="animate-spin text-nd-accent" />
        </div>
      )}

      {/* Data Grid */}
      <div className="relative flex-1 overflow-hidden">
        <DataGrid
          result={result}
          onSort={handleSort}
          isLoading={isLoading}
          onCellEdit={handleCellEdit}
          columnMeta={columnMeta}
        />
      </div>

      {/* Pagination */}
      <PaginationBar
        pagination={pagination}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        executionTimeMs={executionTimeMs}
      />
    </div>
  )
})

export default DataTabView
