import React, { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import { DataGrid, type ForeignKeyMap, type DataGridHandle } from '@/components/sql/DataGrid'
import { PaginationBar, type TableViewMode } from '@/components/sql/PaginationBar'
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

// Lazy-load StructureTabView — only needed when user toggles to structure mode
const LazyStructureTabView = lazy(() => import('./StructureTabView'))

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
    // Strip synthetic keys injected by the grid (e.g. __rowIndex)
    const pk: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      if (!k.startsWith('__')) pk[k] = v
    }
    return pk
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
  // Store — staged changes + connection info for inline editing
  const { upsertStagedChange, removeStagedChange, stagedChanges, addHistoryEntry, connectionConfig, currentDatabase } = useSQLConnection(connectionId)

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
  const [foreignKeyMap, setForeignKeyMap] = useState<ForeignKeyMap>({})
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([])
  const [isCountLoading, setIsCountLoading] = useState(false)

  // View mode: 'data' (grid) or 'structure' (table structure editor)
  const [viewMode, setViewMode] = useState<TableViewMode>('data')
  // Track if structure view has been visited — mount on first visit, keep alive after
  const [structureMounted, setStructureMounted] = useState(false)

  // Ref for DataGrid imperative handle (column visibility controls)
  const dataGridRef = useRef<DataGridHandle>(null)

  // Refs for cancellation, debouncing, and race condition prevention
  const abortRef = useRef<AbortController | null>(null)
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queryIdRef = useRef(0)

  // Cache key to avoid re-fetching when switching back to a loaded tab
  const cacheKeyRef = useRef<string>('')
  const resultRef = useRef<QueryResult | null>(null)

  // ── Query logging helper (uses ref to avoid circular deps with executeQuery) ──
   const logQueryRef = useRef<(query: string, params: unknown[] | undefined, timeMs: number, rowCount?: number, errorMsg?: string) => void>(() => {})

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

        const t0 = performance.now()
        const queryResponse = await (window as any).novadeck.sql.query(
          sqlSessionId,
          query,
          params
        )
        const elapsed = performance.now() - t0

        // Check again after async call
        if (controller.signal.aborted || thisQueryId !== queryIdRef.current) return

        // Log the SELECT query
        logQueryRef.current(query, params, elapsed, queryResponse.data?.rowCount, queryResponse.success ? undefined : queryResponse.error)

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

        // Fetch row count — use fast estimated count when no filters are active,
        // exact COUNT(*) only when filters are applied (filtered sets are typically small).
        if (controller.signal.aborted || thisQueryId !== queryIdRef.current) return

        const hasFilters = currentFilters.length > 0

        if (hasFilters) {
          // Exact count needed for filtered results
          const { query: countQuery, params: countParams } = buildCountQuery(
            table,
            schema,
            dbType,
            currentFilters
          )

          const ct0 = performance.now()
          const countResponse = await (window as any).novadeck.sql.query(
            sqlSessionId,
            countQuery,
            countParams
          )
          const cElapsed = performance.now() - ct0

          if (controller.signal.aborted || thisQueryId !== queryIdRef.current) return

          logQueryRef.current(countQuery, countParams, cElapsed, undefined, countResponse.success ? undefined : countResponse.error)

          if (!countResponse.success) {
            throw new Error(countResponse.error ?? 'Count query failed')
          }
          const countResult: QueryResult = countResponse.data

          const totalRows = Number((countResult.rows[0] as any)?.count ?? 0)
          const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))

          setPagination({ page, pageSize, totalRows, totalPages, isEstimatedCount: false })
        } else {
          // Fast estimated count from DB statistics (INFORMATION_SCHEMA / pg_class)
          const estimateResponse = await (window as any).novadeck.sql.getRowCount(
            sqlSessionId,
            table,
            schema
          )

          if (controller.signal.aborted || thisQueryId !== queryIdRef.current) return

          const totalRows = estimateResponse?.success
            ? Math.max(0, Number(estimateResponse.data ?? 0))
            : 0
          const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))

          setPagination({ page, pageSize, totalRows, totalPages, isEstimatedCount: true })
        }
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

    // Fetch foreign key metadata for FK navigation arrows
    ;(async () => {
      try {
        const res = await (window as any).novadeck.sql.getForeignKeys(sqlSessionId, table, schema)
        if (res?.success && Array.isArray(res.data)) {
          const fkMap: ForeignKeyMap = {}
          for (const fk of res.data) {
            // Map each FK column to its referenced table/column
            for (let i = 0; i < fk.columns.length; i++) {
              fkMap[fk.columns[i]] = {
                referencedTable: fk.referencedTable,
                referencedColumn: fk.referencedColumns[i] || fk.referencedColumns[0],
              }
            }
          }
          setForeignKeyMap(fkMap)
        }
      } catch {
        // Non-critical — FK arrows just won't appear
      }
    })()

    return () => {
      abortRef.current?.abort()
      if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current)
    }
  }, [table, schema, connectionId, sqlSessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──

  // Clear pending changes when data context changes (page, sort, filter)
  // Row indices are positional — navigating makes them point to different rows
  const discardPendingChanges = useCallback(() => {
    const currentTableChanges = stagedChanges.filter(
      (c) => c.table === table && (c.schema ?? undefined) === (schema ?? undefined)
    )
    if (currentTableChanges.length > 0) {
      for (const change of currentTableChanges) {
        removeStagedChange(change.id)
      }
      originalValuesRef.current.clear()
    }
  }, [stagedChanges, table, schema, removeStagedChange])

  const handlePageChange = useCallback(
    (page: number) => {
      discardPendingChanges()
      setPagination((prev) => ({ ...prev, page }))
      executeQuery({
        page,
        pageSize: pagination.pageSize,
        sort: sortColumn,
        sortDir: sortDirection,
        currentFilters: filters,
      })
    },
    [executeQuery, pagination.pageSize, sortColumn, sortDirection, filters, discardPendingChanges]
  )

  const handlePageSizeChange = useCallback(
    (pageSize: number) => {
      discardPendingChanges()
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
    [executeQuery, sortColumn, sortDirection, filters, discardPendingChanges]
  )

  const handleSort = useCallback(
    (column: string | null, direction: 'asc' | 'desc') => {
      discardPendingChanges()
      if (column === null) {
        setSortColumn(undefined)
        setSortDirection('asc')
        executeQuery({
          page: 1,
          pageSize: pagination.pageSize,
          sort: undefined,
          sortDir: undefined,
          currentFilters: filters,
        })
      } else {
        setSortColumn(column)
        setSortDirection(direction)
        executeQuery({
          page: 1,
          pageSize: pagination.pageSize,
          sort: column,
          sortDir: direction,
          currentFilters: filters,
        })
      }
    },
    [executeQuery, pagination.pageSize, filters, discardPendingChanges]
  )

  // Header context menu → add a filter for a specific column
  const handleFilterColumn = useCallback(
    (column: string) => {
      const newFilter: TableFilter = {
        id: crypto.randomUUID(),
        enabled: true,
        column,
        operator: 'equals',
        value: '',
      }
      setFilters((prev) => [...prev, newFilter])
    },
    []
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
      discardPendingChanges()
      setPagination((prev) => ({ ...prev, page: 1 }))
      executeQuery({
        page: 1,
        pageSize: pagination.pageSize,
        sort: sortColumn,
        sortDir: sortDirection,
        currentFilters: filtersRef.current,
      })
    }, FILTER_DEBOUNCE_MS)
  }, [executeQuery, pagination.pageSize, sortColumn, sortDirection, discardPendingChanges])

  // ── Staged insert rows (computed early — used by handleCellEdit) ──

  const insertChanges = useMemo(
    () => stagedChanges.filter(
      (c) => c.type === 'insert' && c.table === table && (c.schema ?? undefined) === (schema ?? undefined) && c.newRow
    ),
    [stagedChanges, table, schema]
  )

  // ── Inline editing → staged changes ──

  // Track original (pre-edit) values per cell so we can detect reverts
  const originalValuesRef = useRef<Map<string, unknown>>(new Map())

  // Reset originals when table changes (new data context)
  // Page/sort changes also get a fresh result set, so row indices reset
  const resetKeyRef = useRef('')
  useEffect(() => {
    const key = `${table}|${schema}|${pagination.page}|${sortColumn}|${sortDirection}`
    if (resetKeyRef.current && resetKeyRef.current !== key) {
      originalValuesRef.current.clear()
    }
    resetKeyRef.current = key
  }, [table, schema, pagination.page, sortColumn, sortDirection])

  const handleCellEdit = useCallback(
    (rowIndex: number, field: string, _oldValue: unknown, newValue: unknown) => {
      const realRowCount = result?.rows?.length ?? 0

      // ── Insert row edit: update the staged insert's newRow directly ──
      if (rowIndex >= realRowCount) {
        const insertIdx = rowIndex - realRowCount
        const insertChange = insertChanges[insertIdx]
        if (!insertChange?.newRow) return

        const updatedRow = { ...insertChange.newRow, [field]: newValue }
        upsertStagedChange({ ...insertChange, newRow: updatedRow })
        return
      }

      // ── Normal row edit (existing DB row) ──
      const cellKey = `edit-${table}-${rowIndex}-${field}`

      // Capture original value on first edit of this cell
      if (!originalValuesRef.current.has(cellKey)) {
        originalValuesRef.current.set(cellKey, _oldValue)
      }
      const originalValue = originalValuesRef.current.get(cellKey)

      // Check if the new value reverts back to the original (strict comparison)
      // ag-grid returns string values from text editors, so compare stringified
      // forms only when both are non-null/non-undefined
      let isReverted = newValue === originalValue
      if (!isReverted && newValue != null && originalValue != null) {
        isReverted = String(newValue) === String(originalValue)
      }

      // Find existing staged change for this cell
      const existingChange = stagedChanges.find((c) => c.id === cellKey)

      if (isReverted) {
        // Value was reverted to original — remove the staged change
        if (existingChange) {
          removeStagedChange(existingChange.id)
        }
        originalValuesRef.current.delete(cellKey)
        return
      }

      const row = result?.rows[rowIndex]
      if (!row) return

      const rowData = row as Record<string, unknown>
      const change: StagedChange = {
        id: cellKey, // Stable ID per cell — allows upsert
        type: 'update',
        table,
        schema,
        primaryKey: buildPrimaryKey(rowData, primaryKeyColumns),
        changes: { [field]: { old: originalValue, new: newValue } },
        rowData,
        column: field,
        oldValue: originalValue,
        newValue,
      }

      // Atomic upsert — replaces existing or inserts new
      upsertStagedChange(change)
    },
    [result, table, schema, primaryKeyColumns, upsertStagedChange, removeStagedChange, stagedChanges, insertChanges]
  )

  // ── Insert / Duplicate row handlers ──

  const handleInsertRow = useCallback(() => {
    if (!result?.fields) return
    const newRow: Record<string, unknown> = {}
    for (const field of result.fields) {
      newRow[field.name] = null
    }
    const change: StagedChange = {
      id: crypto.randomUUID(),
      type: 'insert',
      table,
      schema,
      newRow,
    }
    upsertStagedChange(change)
  }, [result?.fields, table, schema, upsertStagedChange])

  const handleDuplicateRow = useCallback((rowData: Record<string, unknown>) => {
    if (!result?.fields) return
    const newRow: Record<string, unknown> = { ...rowData }
    // Null out auto-increment columns so the DB assigns new values
    if (columnMeta) {
      for (const col of columnMeta) {
        if (col.isAutoIncrement) {
          newRow[col.name] = null
        }
      }
    }
    const change: StagedChange = {
      id: crypto.randomUUID(),
      type: 'insert',
      table,
      schema,
      newRow,
    }
    upsertStagedChange(change)
  }, [result?.fields, table, schema, columnMeta, upsertStagedChange])

  // Compute edited rows/cells for visual highlighting
  // Change IDs follow pattern: "edit-{table}-{rowIndex}-{field}"
  const { editedRows, editedCells } = useMemo(() => {
    const rows = new Set<number>()
    const cells = new Set<string>()
    const prefix = `edit-${table}-`
    for (const change of stagedChanges) {
      if (change.id.startsWith(prefix) && change.type === 'update') {
        // Parse rowIndex and field from the stable ID
        const rest = change.id.slice(prefix.length)
        const dashIdx = rest.indexOf('-')
        if (dashIdx !== -1) {
          const rowIdx = parseInt(rest.slice(0, dashIdx), 10)
          const field = rest.slice(dashIdx + 1)
          if (!isNaN(rowIdx)) {
            rows.add(rowIdx)
            cells.add(`${rowIdx}-${field}`)
          }
        }
      }
    }
    // Mark insert rows as edited — they are appended after real rows
    // so their __rowIndex = result.rows.length + i
    const baseIdx = result?.rows?.length ?? 0
    for (let i = 0; i < insertChanges.length; i++) {
      rows.add(baseIdx + i)
    }
    return { editedRows: rows, editedCells: cells }
  }, [stagedChanges, table, insertChanges, result?.rows?.length])

  // ── Save staged changes to database ──
  const [isSaving, setIsSaving] = useState(false)
  const savingRef = useRef(false) // Synchronous guard against double-click/Ctrl+S

  // Filter staged changes to only those for the current table
  const tableChanges = useMemo(
    () => stagedChanges.filter((c) => c.table === table && (c.schema ?? undefined) === (schema ?? undefined)),
    [stagedChanges, table, schema]
  )

  /** Interpolate parameter placeholders for display in the query log */
  const formatQueryForLog = useCallback((query: string, params?: unknown[]): string => {
    if (!params || params.length === 0) return query
    let idx = 0
    // Handle both ? (MySQL) and $N (Postgres) placeholders
    return query.replace(/\?|\$\d+/g, (match) => {
      const paramIdx = match === '?' ? idx++ : parseInt(match.slice(1), 10) - 1
      const val = params[paramIdx]
      if (val === null || val === undefined) return 'NULL'
      if (typeof val === 'number') return String(val)
      if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE'
      // String values — escape single quotes for display
      return `'${String(val).replace(/'/g, "''")}'`
    })
  }, [])

  /** Helper: log a query to the history store */
  const logQuery = useCallback((query: string, params: unknown[] | undefined, timeMs: number, rowCount?: number, errorMsg?: string) => {
    addHistoryEntry({
      id: crypto.randomUUID(),
      query: formatQueryForLog(query, params),
      database: '', // filled later from currentDatabase if needed
      executedAt: Date.now(),
      executionTimeMs: timeMs,
      rowCount,
      error: errorMsg,
      isFavorite: false,
    })
  }, [addHistoryEntry, formatQueryForLog])

  // Keep the ref in sync so executeQuery can call it without a dep cycle
  logQueryRef.current = logQuery

  const handleSaveChanges = useCallback(async () => {
    if (tableChanges.length === 0 || savingRef.current) return
    savingRef.current = true
    setIsSaving(true)
    setError(null)

    const queryApi = (window as any).novadeck.sql

    try {
      // ── BEGIN transaction ──
      const beginT0 = performance.now()
      const beginRes = await queryApi.query(sqlSessionId, 'BEGIN', [])
      logQuery('BEGIN', undefined, performance.now() - beginT0, undefined, beginRes.success ? undefined : beginRes.error)
      if (!beginRes.success) {
        throw new Error(`BEGIN failed: ${beginRes.error}`)
      }

      const updateSQLs: string[] = []

      for (const change of tableChanges) {
        if (change.type !== 'update' || !change.primaryKey || !change.changes) continue

        // Build UPDATE SQL
        const setClauses: string[] = []
        const params: unknown[] = []
        let paramIdx = 1

        for (const [col, { new: newVal }] of Object.entries(change.changes)) {
          if (dbType === 'mysql') {
            setClauses.push(`${quoteIdentifier(col, dbType)} = ?`)
          } else {
            setClauses.push(`${quoteIdentifier(col, dbType)} = $${paramIdx}`)
            paramIdx++
          }
          params.push(newVal)
        }

        // Build WHERE clause from primary key
        const whereParts: string[] = []
        for (const [col, val] of Object.entries(change.primaryKey)) {
          const quotedCol = quoteIdentifier(col, dbType)
          if (val === null || val === undefined) {
            whereParts.push(`${quotedCol} IS NULL`)
          } else if (dbType === 'mysql') {
            whereParts.push(`${quotedCol} = ?`)
            params.push(val)
          } else {
            whereParts.push(`${quotedCol} = $${paramIdx}`)
            paramIdx++
            params.push(val)
          }
        }

        const fullTable = buildFullTableName(change.table, change.schema, dbType)
        const limitClause = dbType === 'mysql' ? ' LIMIT 1' : ''
        const sql = `UPDATE ${fullTable} SET ${setClauses.join(', ')} WHERE ${whereParts.join(' AND ')}${limitClause}`

        const t0 = performance.now()
        const res = await queryApi.query(sqlSessionId, sql, params)
        const elapsed = performance.now() - t0
        logQuery(sql, params, elapsed, res.data?.affectedRows, res.success ? undefined : res.error)

        if (!res.success) {
          throw new Error(`${change.column ?? 'update'}: ${res.error}`)
        }

        updateSQLs.push(sql)
      }

      // ── Process INSERT changes ──
      const autoIncrCols = new Set(
        columnMeta?.filter((c) => c.isAutoIncrement).map((c) => c.name) ?? []
      )

      for (const change of tableChanges) {
        if (change.type !== 'insert' || !change.newRow) continue

        // Filter out auto-increment columns with null values — let DB assign them
        const entries = Object.entries(change.newRow).filter(
          ([col, val]) => !(autoIncrCols.has(col) && (val === null || val === undefined))
        )
        if (entries.length === 0) continue

        const columns = entries.map(([col]) => col)
        const values = entries.map(([, val]) => val)
        const fullTable = buildFullTableName(change.table, change.schema, dbType)

        const quotedCols = columns.map((c) => quoteIdentifier(c, dbType)).join(', ')
        let placeholders: string
        if (dbType === 'mysql') {
          placeholders = columns.map(() => '?').join(', ')
        } else {
          placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
        }

        const sql = `INSERT INTO ${fullTable} (${quotedCols}) VALUES (${placeholders})`
        const params = values

        const t0 = performance.now()
        const res = await queryApi.query(sqlSessionId, sql, params)
        const elapsed = performance.now() - t0
        logQuery(sql, params, elapsed, res.data?.affectedRows, res.success ? undefined : res.error)

        if (!res.success) {
          throw new Error(`insert: ${res.error}`)
        }

        updateSQLs.push(sql)
      }

      // ── COMMIT transaction ──
      const commitT0 = performance.now()
      const commitRes = await queryApi.query(sqlSessionId, 'COMMIT', [])
      logQuery('COMMIT', undefined, performance.now() - commitT0, undefined, commitRes.success ? undefined : commitRes.error)

      if (!commitRes.success) {
        throw new Error(`COMMIT failed: ${commitRes.error}`)
      }

      // All changes saved — clear them
      for (const change of tableChanges) {
        removeStagedChange(change.id)
        originalValuesRef.current.delete(change.id)
      }

      // Refresh data
      executeQuery({
        page: pagination.page,
        pageSize: pagination.pageSize,
        sort: sortColumn,
        sortDir: sortDirection,
        currentFilters: filters,
      })
    } catch (err: any) {
      // ── ROLLBACK on any failure ──
      try {
        const rbT0 = performance.now()
        const rbRes = await queryApi.query(sqlSessionId, 'ROLLBACK', [])
        logQuery('ROLLBACK', undefined, performance.now() - rbT0, undefined, rbRes.success ? undefined : rbRes.error)
      } catch {
        // Rollback failed — nothing we can do
      }
      setError(err.message || String(err))
    } finally {
      setIsSaving(false)
      savingRef.current = false
    }
  }, [tableChanges, dbType, sqlSessionId, removeStagedChange, logQuery, executeQuery, pagination, sortColumn, sortDirection, filters, columnMeta])

  const handleDiscardChanges = useCallback(() => {
    // Only remove changes for this table, not all connection changes
    for (const change of tableChanges) {
      removeStagedChange(change.id)
      originalValuesRef.current.delete(change.id)
    }

    // Refresh data to restore original values in the grid
    executeQuery({
      page: pagination.page,
      pageSize: pagination.pageSize,
      sort: sortColumn,
      sortDir: sortDirection,
      currentFilters: filters,
    })
  }, [tableChanges, removeStagedChange, executeQuery, pagination, sortColumn, sortDirection, filters])

  // ── Listen for insert-row event from shortcuts + pagination bar ──
  useEffect(() => {
    const handleInsertRowEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail
      // Scoped: only respond if no detail (PaginationBar click in our own tab)
      // or detail matches this tab's connectionId + table
      if (detail?.connectionId && detail.connectionId !== connectionId) return
      if (detail?.table && detail.table !== table) return
      handleInsertRow()
    }
    window.addEventListener('sql:insert-row', handleInsertRowEvent)
    return () => window.removeEventListener('sql:insert-row', handleInsertRowEvent)
  }, [handleInsertRow, connectionId, table])

  // ── Listen for save/discard events from shortcuts + status bar ──
  useEffect(() => {
    const handleApplyChanges = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.connectionId === connectionId) {
        handleSaveChanges()
      }
    }
    const handleDiscardEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.connectionId === connectionId) {
        handleDiscardChanges()
      }
    }
    const handleRefreshData = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.connectionId === connectionId) {
        // Invalidate cache so re-fetch is forced
        cacheKeyRef.current = ''
        executeQuery({
          page: pagination.page,
          pageSize: pagination.pageSize,
          sort: sortColumn,
          sortDir: sortDirection,
          currentFilters: filters,
        })
      }
    }
    window.addEventListener('sql:apply-changes', handleApplyChanges)
    window.addEventListener('sql:discard-changes', handleDiscardEvent)
    window.addEventListener('sql:refresh-data', handleRefreshData)
    return () => {
      window.removeEventListener('sql:apply-changes', handleApplyChanges)
      window.removeEventListener('sql:discard-changes', handleDiscardEvent)
      window.removeEventListener('sql:refresh-data', handleRefreshData)
    }
  }, [connectionId, handleSaveChanges, handleDiscardChanges, executeQuery, pagination, sortColumn, sortDirection, filters])

  // ── Listen for FK filter navigation — sets a filter from external navigation ──
  useEffect(() => {
    const handleSetFilter = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.connectionId !== connectionId || detail?.table !== table) return

      const newFilter: TableFilter = {
        id: crypto.randomUUID(),
        enabled: true,
        column: detail.column,
        operator: 'equals',
        value: String(detail.value),
      }
      // Replace filters (FK navigation = fresh context)
      const newFilters = [newFilter]
      filtersRef.current = newFilters
      setFilters(newFilters)
      // Trigger query with the new filter
      setPagination((p) => ({ ...p, page: 1 }))
      executeQuery({
        page: 1,
        pageSize: pagination.pageSize,
        sort: sortColumn,
        sortDir: sortDirection,
        currentFilters: newFilters,
      })
    }
    window.addEventListener('sql:set-filter', handleSetFilter)
    return () => window.removeEventListener('sql:set-filter', handleSetFilter)
  }, [connectionId, table, executeQuery, pagination.pageSize, sortColumn, sortDirection])

  // ── FK navigation — dispatch event to open referenced table with filter ──
  const handleNavigateFK = useCallback((refTable: string, refColumn: string, value: unknown) => {
    window.dispatchEvent(
      new CustomEvent('sql:navigate-fk', {
        detail: { connectionId, table: refTable, filterColumn: refColumn, filterValue: value },
      })
    )
  }, [connectionId])

  // ── Listen for external view-mode switch (e.g. context menu "View Structure") ──
  useEffect(() => {
    const handleSwitchToStructure = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.connectionId === connectionId && detail?.table === table) {
        setViewMode('structure')
        setStructureMounted(true)
      }
    }
    window.addEventListener('sql:switch-to-structure', handleSwitchToStructure)
    return () => window.removeEventListener('sql:switch-to-structure', handleSwitchToStructure)
  }, [connectionId, table])

  // ── Listen for view-mode toggle from keyboard shortcut ──
  useEffect(() => {
    const handleToggleViewMode = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.connectionId === connectionId && detail?.table === table) {
        setViewMode((prev) => {
          const next = prev === 'data' ? 'structure' : 'data'
          if (next === 'structure') setStructureMounted(true)
          return next
        })
      }
    }
    window.addEventListener('sql:toggle-view-mode', handleToggleViewMode)
    return () => window.removeEventListener('sql:toggle-view-mode', handleToggleViewMode)
  }, [connectionId, table])

  // ── View mode change handler for PaginationBar toggle ──
  const handleViewModeChange = useCallback((mode: TableViewMode) => {
    setViewMode(mode)
    if (mode === 'structure') setStructureMounted(true)
  }, [])

  // Memoize columns for FilterBar
  const filterColumns = useMemo(() => columns, [columns])

  // Column visibility callbacks for PaginationBar ↔ DataGrid
  const handleHiddenColumnsChange = useCallback((cols: string[]) => {
    setHiddenColumns(cols)
  }, [])

  const handleToggleColumn = useCallback((colId: string, show: boolean) => {
    dataGridRef.current?.toggleColumn(colId, show)
  }, [])

  const handleShowAllColumns = useCallback(() => {
    dataGridRef.current?.showAllColumns()
  }, [])

  // On-demand exact COUNT(*) — replaces estimated count with real value
  const handleExactCount = useCallback(async () => {
    if (!sqlSessionId || isCountLoading) return
    setIsCountLoading(true)
    try {
      const { query: countQuery, params: countParams } = buildCountQuery(table, schema, dbType, filters)
      const ct0 = performance.now()
      const countResponse = await (window as any).novadeck.sql.query(sqlSessionId, countQuery, countParams)
      const cElapsed = performance.now() - ct0

      logQueryRef.current(countQuery, countParams, cElapsed, undefined, countResponse.success ? undefined : countResponse.error)

      if (countResponse.success) {
        const totalRows = Number(((countResponse.data as QueryResult).rows[0] as any)?.count ?? 0)
        const totalPages = Math.max(1, Math.ceil(totalRows / pagination.pageSize))
        setPagination((prev) => ({ ...prev, totalRows, totalPages, isEstimatedCount: false }))
      }
    } catch {
      // Non-critical — keep the estimated count
    } finally {
      setIsCountLoading(false)
    }
  }, [sqlSessionId, table, schema, dbType, filters, pagination.pageSize, isCountLoading])

  // Stable key for persisting column widths per table across sessions
  // Format: sql-colw:{type}:{host}:{port}:{database}:{schema}.{table}
  const columnWidthsKey = useMemo(() => {
    if (!connectionConfig) return undefined
    const parts = [
      'sql-colw',
      connectionConfig.type,
      connectionConfig.host,
      connectionConfig.port,
      currentDatabase || connectionConfig.database || '_',
      schema ? `${schema}.${table}` : table,
    ]
    return parts.join(':')
  }, [connectionConfig, currentDatabase, schema, table])

  // ── Derived result that includes staged insert rows at the bottom ──
  const resultWithInserts = useMemo<QueryResult | null>(() => {
    if (!result || insertChanges.length === 0) return result
    const insertRows = insertChanges.map((c) => c.newRow as Record<string, unknown>)
    return {
      ...result,
      rows: [...result.rows, ...insertRows],
    }
  }, [result, insertChanges])

  const isDataMode = viewMode === 'data'

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Filter Bar — only visible in data mode */}
      {isDataMode && (
        <FilterBar
          filters={filters}
          columns={filterColumns}
          onFiltersChange={handleFiltersChange}
          onApply={handleFiltersApply}
        />
      )}

      {/* Error banner — only show data errors in data mode */}
      {isDataMode && error && (
        <div className="shrink-0 border-b border-nd-error/30 bg-nd-error/10 px-3 py-1.5 text-xs text-nd-error">
          {error}
        </div>
      )}

      {/* Loading indicator — only in data mode */}
      {isDataMode && isLoading && (
        <div className="absolute right-3 top-3 z-10">
          <Loader2 size={16} className="animate-spin text-nd-accent" />
        </div>
      )}

      {/* Data Grid — hidden (not unmounted) when in structure mode to preserve scroll/state */}
      <div className={cn('relative flex-1 overflow-hidden', !isDataMode && 'hidden')}>
        <DataGrid
          ref={dataGridRef}
          result={resultWithInserts}
          onSort={handleSort}
          isLoading={isLoading}
          onCellEdit={handleCellEdit}
          columnMeta={columnMeta}
          onFilterColumn={handleFilterColumn}
          editedRows={editedRows}
          editedCells={editedCells}
          columnWidthsKey={columnWidthsKey}
          foreignKeys={foreignKeyMap}
          onNavigateFK={handleNavigateFK}
          onHiddenColumnsChange={handleHiddenColumnsChange}
          onInsertRow={handleInsertRow}
          onDuplicateRow={handleDuplicateRow}
        />
      </div>

      {/* Structure View — lazy loaded, mounted on first visit, hidden when not active */}
      {structureMounted && (
        <div className={cn('relative flex-1 overflow-hidden', isDataMode && 'hidden')}>
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin w-4 h-4 rounded-full border-2 border-nd-accent border-t-transparent" />
              </div>
            }
          >
            <LazyStructureTabView
              sqlSessionId={sqlSessionId}
              table={table}
              schema={schema}
              dbType={dbType}
              connectionId={connectionId}
            />
          </Suspense>
        </div>
      )}

      {/* Pagination / Bottom Bar with Data|Structure toggle */}
      <PaginationBar
        pagination={pagination}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        onExactCount={handleExactCount}
        isCountLoading={isCountLoading}
        executionTimeMs={executionTimeMs}
        fields={result?.fields}
        hiddenColumns={hiddenColumns}
        foreignKeys={foreignKeyMap}
        onToggleColumn={handleToggleColumn}
        onShowAllColumns={handleShowAllColumns}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
      />
    </div>
  )
})

export default DataTabView
