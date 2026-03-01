import React, { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import { DataGrid, type ForeignKeyMap, type DataGridHandle } from '@/components/sql/DataGrid'
import { PaginationBar, type TableViewMode } from '@/components/sql/PaginationBar'
import { FilterBar } from '@/components/sql/FilterBar'
import { buildWhereClause } from '@/utils/sqlFilterBuilder'
import { useSQLConnection } from '@/stores/sqlStore'
import { SQL_EXPR_PREFIX, resolveSQLExpr } from '@/components/sql/TimestampCellEditor'
import type {
  DatabaseType,
  PaginationState,
  QueryResult,
  QueryField,
  TableFilter,
  StagedChange,
  SchemaColumn,
  SchemaIndex,
  SchemaForeignKey,
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
  /** Primary key columns — used as default ORDER BY when no explicit sort is set */
  primaryKeyColumns?: string[]
}): { query: string; params: unknown[] } {
  const { table, schema, dbType, page, pageSize, sortColumn, sortDirection, filters, primaryKeyColumns } =
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
  } else if (primaryKeyColumns && primaryKeyColumns.length > 0) {
    // Default: order by primary key ASC for consistent results (oldest → newest)
    const pkOrder = primaryKeyColumns.map(col => `${quoteIdentifier(col, dbType)} ASC`).join(', ')
    query += ` ORDER BY ${pkOrder}`
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

// ── Cell value comparison ──

/**
 * Compare two cell values for equality, normalising for type mismatches caused
 * by ag-grid's text editor (always returns strings). Handles:
 *  - null/undefined symmetry (null == undefined → true)
 *  - Date ↔ string (PG returns Date objects; ag-grid text editor returns strings)
 *  - numeric string ↔ number ("42" == 42)
 *  - SQL expression sentinels — never equal to an original DB value
 */
/** Normalise a date/timestamp string for comparison — collapse "T" ↔ " " separator */
function normaliseDateStr(s: string): string {
  // "2023-09-03T16:13:26" → "2023-09-03 16:13:26" (standard SQL format)
  return s.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/, '$1 $2')
}

function valuesAreEqual(a: unknown, b: unknown): boolean {
  // Strict match (handles string↔string for MySQL dateStrings)
  if (a === b) return true
  // null / undefined equivalence
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true
  // If either is null/undefined but not both, they differ
  if (a == null || b == null) return false
  // SQL expression sentinels are never "equal" to an original DB value
  if (typeof a === 'string' && a.startsWith(SQL_EXPR_PREFIX)) return false
  if (typeof b === 'string' && b.startsWith(SQL_EXPR_PREFIX)) return false
  // Date ↔ string: normalise Date to its toString() form (what ag-grid text editor produces)
  const strA = a instanceof Date ? a.toString() : String(a)
  const strB = b instanceof Date ? b.toString() : String(b)
  if (strA === strB) return true
  // Also compare with normalised date format (space vs T separator)
  return normaliseDateStr(strA) === normaliseDateStr(strB)
}

// ── Default state ──

const DEFAULT_PAGE_SIZE = 200


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
  const { upsertStagedChange, removeStagedChange, stagedChanges, connectionConfig, currentDatabase, addRunningQuery } = useSQLConnection(connectionId)

  // Stable key for persisting filters per table across sessions
  // Format: sql-flt:{type}:{host}:{port}:{database}:{schema}.{table}
  const filtersKey = useMemo(() => {
    if (!connectionConfig) return undefined
    const parts = [
      'sql-flt',
      connectionConfig.type,
      connectionConfig.host,
      connectionConfig.port,
      currentDatabase || connectionConfig.database || '_',
      schema ? `${schema}.${table}` : table,
    ]
    return parts.join(':')
  }, [connectionConfig, currentDatabase, schema, table])

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
  const [foreignKeysRaw, setForeignKeysRaw] = useState<SchemaForeignKey[]>([])
  const [indexes, setIndexes] = useState<SchemaIndex[]>([])
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

  const queryIdRef = useRef(0)
  /** Tracks the IPC-level queryId for server-side cancellation */
  const ipcQueryIdRef = useRef<string | null>(null)
  /** Tracks the IPC-level queryId for the count/estimate query so it can be
   *  cancelled server-side when a new data query starts — prevents the old
   *  count query from holding the single MySQL connection busy. */
  const countQueryIdRef = useRef<string | null>(null)

  // Ref for primary key columns — used by buildDataQuery for default ORDER BY
  // Using a ref so executeQuery doesn't need to be recreated when PKs load
  const primaryKeyColumnsRef = useRef<string[]>([])

  // Cache key to avoid re-fetching when switching back to a loaded tab
  const cacheKeyRef = useRef<string>('')
  const resultRef = useRef<QueryResult | null>(null)
  // Tracks whether the currently displayed data was fetched with active filters
  const [isDataFiltered, setIsDataFiltered] = useState(false)

  // Query logging is now handled by the main-process query-executed event (subscribed in SQLView)

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

      // Cancel any in-flight query (renderer-side only — abort prevents stale state updates).
      // We do NOT send server-side KILL QUERY for the DATA query because KILL QUERY
      // targets the connection thread, not a specific query. On a shared connection,
      // the KILL can race and kill a DIFFERENT query that started executing after the
      // intended target completed. Server-side KILL is only safe for explicit user
      // actions (QueryMonitor).
      if (abortRef.current) {
        abortRef.current.abort()
      }

      // Cancel any in-flight COUNT / estimated-count query server-side.
      // Unlike the data query, we actively kill this one because it may be
      // holding the single MySQL connection busy, blocking the new data query
      // from starting.  The count query is non-critical — pagination will just
      // keep its previous values if the kill succeeds before it completes.
      if (countQueryIdRef.current) {
        ;(window as any).novadeck.sql.cancelQuery(countQueryIdRef.current).catch(() => {})
        countQueryIdRef.current = null
      }
      const controller = new AbortController()
      abortRef.current = controller
      const thisQueryId = ++queryIdRef.current
      const thisIpcQueryId = crypto.randomUUID()
      ipcQueryIdRef.current = thisIpcQueryId

      // Pre-register with the store so QueryMonitor shows it with correct source
      addRunningQuery({
        queryId: thisIpcQueryId,
        sqlSessionId,
        query: `SELECT * FROM ${table}`,
        startedAt: Date.now(),
        source: 'data',
        table,
      })

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
          primaryKeyColumns: primaryKeyColumnsRef.current,
        })

        // Check if this query is still current
        if (controller.signal.aborted || thisQueryId !== queryIdRef.current) return

        const queryResponse = await (window as any).novadeck.sql.query(
          sqlSessionId,
          query,
          params,
          thisIpcQueryId
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

        // Data is ready — clear loading overlay immediately so the grid is interactive.
        // The row count query below may take much longer on large tables; it uses
        // its own `isCountLoading` state so the PaginationBar can show a spinner
        // without blocking the entire grid.
        setIsLoading(false)

        // Fetch row count — always start with the fast estimated count from
        // DB statistics (INFORMATION_SCHEMA / pg_class).  Only auto-run an exact
        // COUNT(*) when the table is small (≤ 500k estimated rows).  For large
        // tables the user can trigger an exact count manually via the "Count"
        // button in the pagination bar — same behaviour for both filtered and
        // unfiltered queries.
        if (controller.signal.aborted || thisQueryId !== queryIdRef.current) return

        const hasFilters = currentFilters.some((f) => f.enabled)
        setIsDataFiltered(hasFilters)

        setIsCountLoading(true)
        // Track the count query so it can be killed server-side if the user
        // triggers a new data query while it's still in-flight.
        const countQid = crypto.randomUUID()
        countQueryIdRef.current = countQid
        try {
          // Step 1: Fast estimated count from DB statistics.
          // Use sql:query directly (instead of the opaque getRowCount IPC) so
          // we can pass our own queryId for cancellation.
          let estimatedRows = 0
          if (dbType === 'mysql') {
            const estRes = await (window as any).novadeck.sql.query(
              sqlSessionId,
              'SELECT TABLE_ROWS as count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
              [table],
              countQid
            )
            if (controller.signal.aborted || thisQueryId !== queryIdRef.current) return
            if (estRes.success) {
              estimatedRows = Math.max(0, Number((estRes.data as QueryResult).rows[0]?.count ?? 0))
            }
          } else {
            const estRes = await (window as any).novadeck.sql.query(
              sqlSessionId,
              'SELECT reltuples::bigint as count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = $1 AND n.nspname = $2',
              [table, schema || 'public'],
              countQid
            )
            if (controller.signal.aborted || thisQueryId !== queryIdRef.current) return
            if (estRes.success) {
              estimatedRows = Math.max(0, Number((estRes.data as QueryResult).rows[0]?.count ?? 0))
            }
          }

          // Step 2: Only auto-count when the table is small enough that
          // COUNT(*) is fast (under ~500k rows).  For multi-million-row tables,
          // use the estimate and let the user request an exact count.
          const EXACT_COUNT_THRESHOLD = 500_000

          if (estimatedRows <= EXACT_COUNT_THRESHOLD) {
            // Small table — exact COUNT(*) is cheap, run it now.
            const { query: countQuery, params: countParams } = buildCountQuery(
              table,
              schema,
              dbType,
              currentFilters
            )
            // New query ID so the server can track/cancel this separately
            const exactCountQid = crypto.randomUUID()
            countQueryIdRef.current = exactCountQid
            const countResponse = await (window as any).novadeck.sql.query(
              sqlSessionId,
              countQuery,
              countParams,
              exactCountQid
            )

            if (controller.signal.aborted || thisQueryId !== queryIdRef.current) return

            if (countResponse.success) {
              const exactRows = Number(
                ((countResponse.data as QueryResult).rows[0] as any)?.count ?? 0
              )
              const totalPages = Math.max(1, Math.ceil(exactRows / pageSize))
              setPagination({ page, pageSize, totalRows: exactRows, totalPages, isEstimatedCount: false })
            } else {
              // Fallback to estimate if exact count fails
              const totalPages = Math.max(1, Math.ceil(estimatedRows / pageSize))
              setPagination({ page, pageSize, totalRows: estimatedRows, totalPages, isEstimatedCount: true })
            }
          } else {
            // Large table — use estimated count, user can click "Count" for exact
            const totalPages = Math.max(1, Math.ceil(estimatedRows / pageSize))
            setPagination({ page, pageSize, totalRows: estimatedRows, totalPages, isEstimatedCount: true })
          }
        } catch {
          // Count query failure is non-critical — keep existing pagination
        } finally {
          if (!controller.signal.aborted && thisQueryId === queryIdRef.current) {
            setIsCountLoading(false)
            countQueryIdRef.current = null
          }
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
    // Restore persisted filters for this table (survives tab close, session close, app restart)
    let savedFilters: TableFilter[] = []
    if (filtersKey) {
      try {
        const raw = localStorage.getItem(filtersKey)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            // Validate each filter has required shape — guards against schema changes
            savedFilters = parsed.filter(
              (f: unknown): f is TableFilter =>
                typeof f === 'object' && f !== null && 'column' in f && 'operator' in f && 'id' in f
            )
          }
        }
      } catch { /* corrupt data — start fresh */ }
    }

    setPagination(defaultPagination())
    setSortColumn(undefined)
    setSortDirection('asc')
    setFilters(savedFilters)
    filtersRef.current = savedFilters
    setResult(null)
    resultRef.current = null
    setError(null)
    setPrimaryKeyColumns([])
    primaryKeyColumnsRef.current = []
    setIndexes([])
    setForeignKeysRaw([])
    cacheKeyRef.current = ''

    // Defer queries to next tick — React StrictMode (dev) synchronously unmounts
    // and remounts components, so clearTimeout in cleanup prevents the first mount's
    // queries from firing. Only the real mount's queries execute, eliminating
    // duplicate queries on the shared MySQL connection.
    const initTimer = setTimeout(() => {
      executeQuery({
        page: 1,
        pageSize: DEFAULT_PAGE_SIZE,
        currentFilters: savedFilters,
      })

      // Fetch all table metadata in a single query (columns, indexes, foreign keys).
      // One network roundtrip over the SSH tunnel instead of three separate queries.
      ;(async () => {
        try {
          const res = await (window as any).novadeck.sql.getTableStructure(sqlSessionId, table, schema)
          if (res?.success && res.data) {
            const { columns: cols, indexes: idxs, foreignKeys: fks } = res.data as {
              columns: SchemaColumn[]; indexes: any[]; foreignKeys: any[]
            }

            // Column metadata — used for inline editing (PK detection, auto-increment)
            setColumnMeta(cols)
            const pkCols = cols.filter((c) => c.isPrimaryKey).map((c) => c.name)
            setPrimaryKeyColumns(pkCols)
            primaryKeyColumnsRef.current = pkCols

            // Index metadata — used by StructureTabView
            setIndexes(idxs)

            // Foreign key metadata — used for FK navigation arrows + StructureTabView
            setForeignKeysRaw(fks)
            const fkMap: ForeignKeyMap = {}
            for (const fk of fks) {
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
          // Non-critical — inline editing falls back to full-row WHERE, FK arrows won't appear
        }
      })()
    }, 0)

    return () => {
      clearTimeout(initTimer)
      abortRef.current?.abort()
      // Reset the query ID ref so stale results are discarded.
      // We do NOT send server-side KILL QUERY in cleanup — see comment in executeQuery.
      ipcQueryIdRef.current = null
    }
  }, [table, schema, connectionId, sqlSessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──

  // Clear pending changes when data context changes (page, sort, filter)
  // Row indices are positional — navigating makes them point to different rows
  const discardPendingChanges = useCallback(() => {
    // Read latest from ref to avoid stale closure
    const currentTableChanges = stagedChangesRef.current.filter(
      (c) => c.table === table && (c.schema ?? undefined) === (schema ?? undefined)
    )
    if (currentTableChanges.length > 0) {
      for (const change of currentTableChanges) {
        removeStagedChange(change.id)
      }
      originalValuesRef.current.clear()
    }
  }, [table, schema, removeStagedChange])

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

  // Track filter ID that needs auto-focus (set when adding filter from column header right-click)
  const [focusFilterId, setFocusFilterId] = useState<string | null>(null)

  // Header context menu → add a filter for a specific column
  const handleFilterColumn = useCallback(
    (column: string) => {
      const id = crypto.randomUUID()
      const newFilter: TableFilter = {
        id,
        enabled: true,
        column,
        operator: 'equals',
        value: '',
      }
      setFocusFilterId(id)
      setFilters((prev) => {
        const updated = [...prev, newFilter]
        // Persist immediately so the new filter row survives tab/app close
        if (filtersKey) {
          try { localStorage.setItem(filtersKey, JSON.stringify(updated)) } catch {}
        }
        return updated
      })
    },
    [filtersKey]
  )

  // Refs always hold latest values so callbacks never use stale closures
  const filtersRef = useRef<TableFilter[]>(filters)
  filtersRef.current = filters
  const stagedChangesRef = useRef(stagedChanges)
  stagedChangesRef.current = stagedChanges

  const handleFiltersChange = useCallback((newFilters: TableFilter[]) => {
    filtersRef.current = newFilters
    setFilters(newFilters)
    // Persist filters to localStorage so they survive tab/session/app close
    if (filtersKey) {
      try {
        if (newFilters.length > 0) {
          localStorage.setItem(filtersKey, JSON.stringify(newFilters))
        } else {
          localStorage.removeItem(filtersKey)
        }
      } catch { /* storage full or unavailable — non-critical */ }
    }
  }, [filtersKey])

  const handleFiltersApply = useCallback(() => {
    // Execute immediately — the user explicitly clicked "Apply" / "Apply All"
    // or pressed Enter, so there is no reason to delay.
    // Reads filtersRef to avoid stale closures.
    discardPendingChanges()
    setPagination((prev) => ({ ...prev, page: 1 }))
    executeQuery({
      page: 1,
      pageSize: pagination.pageSize,
      sort: sortColumn,
      sortDir: sortDirection,
      currentFilters: filtersRef.current,
    })
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
      // Read latest from ref to avoid stale closure (same pattern as handleDeleteRows)
      const currentStaged = stagedChangesRef.current
      const currentInserts = currentStaged.filter(
        (c) => c.type === 'insert' && c.table === table && (c.schema ?? undefined) === (schema ?? undefined) && c.newRow
      )

      // ── Insert row edit: update the staged insert's newRow directly ──
      if (rowIndex >= realRowCount) {
        const insertIdx = rowIndex - realRowCount
        const insertChange = currentInserts[insertIdx]
        if (!insertChange?.newRow) return

        const updatedRow = { ...insertChange.newRow, [field]: newValue }
        upsertStagedChange({ ...insertChange, newRow: updatedRow })
        return
      }

      // ── Early exit: if old and new values are effectively the same, skip ──
      // ag-grid's text editor always returns strings, so a Date object from PG
      // becomes its string form. Compare normalized forms to avoid false positives.
      if (valuesAreEqual(_oldValue, newValue)) return

      // ── Normal row edit (existing DB row) ──
      const cellKey = `edit-${table}-${rowIndex}-${field}`

      // Capture original value on first edit of this cell
      if (!originalValuesRef.current.has(cellKey)) {
        originalValuesRef.current.set(cellKey, _oldValue)
      }
      const originalValue = originalValuesRef.current.get(cellKey)

      // Check if the new value reverts back to the original
      // ag-grid returns string values from text editors, so compare normalised forms
      const isReverted = valuesAreEqual(newValue, originalValue)

      // Find existing staged change for this cell
      const existingChange = currentStaged.find((c) => c.id === cellKey)

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
    [result, table, schema, primaryKeyColumns, upsertStagedChange, removeStagedChange]
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

  // ── Delete row handler ──
  // Uses stagedChangesRef to always read the latest staged changes and avoid stale closures
  // (React batching can delay callback recreation after Zustand updates)
  const handleDeleteRows = useCallback((rowIndices: number[]) => {
    if (!result?.rows) return
    const realRowCount = result.rows.length
    // Read latest from ref to avoid stale closure when user quickly adds then deletes a row
    const currentStaged = stagedChangesRef.current
    const currentInserts = currentStaged.filter(
      (c) => c.type === 'insert' && c.table === table && (c.schema ?? undefined) === (schema ?? undefined) && c.newRow
    )

    for (const rowIndex of rowIndices) {
      // If the row is an inserted (staged) row, just remove the staged insert
      if (rowIndex >= realRowCount) {
        const insertIdx = rowIndex - realRowCount
        const insertChange = currentInserts[insertIdx]
        if (insertChange) {
          removeStagedChange(insertChange.id)
        }
        continue
      }

      const row = result.rows[rowIndex] as Record<string, unknown>
      if (!row) continue

      const changeId = `delete-${table}-${rowIndex}`

      // If this row already has a delete staged, skip
      if (currentStaged.find((c) => c.id === changeId)) continue

      // Also remove any pending edit changes for this row
      const editPrefix = `edit-${table}-${rowIndex}-`
      for (const c of currentStaged) {
        if (c.id.startsWith(editPrefix)) {
          removeStagedChange(c.id)
          originalValuesRef.current.delete(c.id)
        }
      }

      const change: StagedChange = {
        id: changeId,
        type: 'delete',
        table,
        schema,
        primaryKey: buildPrimaryKey(row, primaryKeyColumns),
        rowData: row,
      }
      upsertStagedChange(change)
    }
  }, [result, table, schema, primaryKeyColumns, upsertStagedChange, removeStagedChange])

  // Compute edited rows/cells for visual highlighting
  // Change IDs follow pattern: "edit-{table}-{rowIndex}-{field}" or "delete-{table}-{rowIndex}"
  const { editedRows, editedCells, deletedRows } = useMemo(() => {
    const rows = new Set<number>()
    const cells = new Set<string>()
    const deleted = new Set<number>()
    const editPrefix = `edit-${table}-`
    const deletePrefix = `delete-${table}-`
    for (const change of stagedChanges) {
      if (change.id.startsWith(editPrefix) && change.type === 'update') {
        // Parse rowIndex and field from the stable ID
        const rest = change.id.slice(editPrefix.length)
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
      if (change.id.startsWith(deletePrefix) && change.type === 'delete') {
        const rowIdx = parseInt(change.id.slice(deletePrefix.length), 10)
        if (!isNaN(rowIdx)) {
          rows.add(rowIdx)
          deleted.add(rowIdx)
        }
      }
    }
    // Mark insert rows as edited — they are appended after real rows
    // so their __rowIndex = result.rows.length + i
    const baseIdx = result?.rows?.length ?? 0
    for (let i = 0; i < insertChanges.length; i++) {
      rows.add(baseIdx + i)
    }
    return { editedRows: rows, editedCells: cells, deletedRows: deleted }
  }, [stagedChanges, table, insertChanges, result?.rows?.length])

  // ── Save staged changes to database ──
  const [isSaving, setIsSaving] = useState(false)
  const savingRef = useRef(false) // Synchronous guard against double-click/Ctrl+S

  // Filter staged changes to only those for the current table
  const tableChanges = useMemo(
    () => stagedChanges.filter((c) => c.table === table && (c.schema ?? undefined) === (schema ?? undefined)),
    [stagedChanges, table, schema]
  )

  const handleSaveChanges = useCallback(async () => {
    if (tableChanges.length === 0 || savingRef.current) return
    savingRef.current = true
    setIsSaving(true)
    setError(null)

    const queryApi = (window as any).novadeck.sql

    try {
      // ── BEGIN transaction ──
      const beginRes = await queryApi.query(sqlSessionId, 'BEGIN', [])
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
          const quotedCol = quoteIdentifier(col, dbType)
          // Handle SQL expression sentinels (NOW(), DEFAULT) — inject whitelisted raw SQL, no parameter
          if (typeof newVal === 'string' && newVal.startsWith(SQL_EXPR_PREFIX)) {
            setClauses.push(`${quotedCol} = ${resolveSQLExpr(newVal)}`)
          } else if (dbType === 'mysql') {
            setClauses.push(`${quotedCol} = ?`)
            params.push(newVal)
          } else {
            setClauses.push(`${quotedCol} = $${paramIdx}`)
            paramIdx++
            params.push(newVal)
          }
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

        const res = await queryApi.query(sqlSessionId, sql, params)

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
        const fullTable = buildFullTableName(change.table, change.schema, dbType)
        const quotedCols = columns.map((c) => quoteIdentifier(c, dbType)).join(', ')

        // Build placeholders and params, handling SQL expression sentinels
        const placeholderParts: string[] = []
        const params: unknown[] = []
        let pgIdx = 1
        for (const [, val] of entries) {
          if (typeof val === 'string' && val.startsWith(SQL_EXPR_PREFIX)) {
            // Whitelisted SQL expression — inject directly, no parameter
            placeholderParts.push(resolveSQLExpr(val))
          } else if (dbType === 'mysql') {
            placeholderParts.push('?')
            params.push(val)
          } else {
            placeholderParts.push(`$${pgIdx}`)
            pgIdx++
            params.push(val)
          }
        }

        const sql = `INSERT INTO ${fullTable} (${quotedCols}) VALUES (${placeholderParts.join(', ')})`

        const res = await queryApi.query(sqlSessionId, sql, params)

        if (!res.success) {
          throw new Error(`insert: ${res.error}`)
        }

        updateSQLs.push(sql)
      }

      // ── Process DELETE changes ──
      for (const change of tableChanges) {
        if (change.type !== 'delete' || !change.primaryKey) continue

        const whereParts: string[] = []
        const delParams: unknown[] = []
        let delParamIdx = 1

        for (const [col, val] of Object.entries(change.primaryKey)) {
          const quotedCol = quoteIdentifier(col, dbType)
          if (val === null || val === undefined) {
            whereParts.push(`${quotedCol} IS NULL`)
          } else if (dbType === 'mysql') {
            whereParts.push(`${quotedCol} = ?`)
            delParams.push(val)
          } else {
            whereParts.push(`${quotedCol} = $${delParamIdx}`)
            delParamIdx++
            delParams.push(val)
          }
        }

        const fullTable = buildFullTableName(change.table, change.schema, dbType)
        const limitClause = dbType === 'mysql' ? ' LIMIT 1' : ''
        const sql = `DELETE FROM ${fullTable} WHERE ${whereParts.join(' AND ')}${limitClause}`

        const res = await queryApi.query(sqlSessionId, sql, delParams)
        if (!res.success) {
          throw new Error(`delete: ${res.error}`)
        }
        updateSQLs.push(sql)
      }

      // ── COMMIT transaction ──
      const commitRes = await queryApi.query(sqlSessionId, 'COMMIT', [])
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
        await queryApi.query(sqlSessionId, 'ROLLBACK', [])
      } catch {
        // Rollback failed — nothing we can do
      }
      setError(err.message || String(err))
    } finally {
      setIsSaving(false)
      savingRef.current = false
    }
  }, [tableChanges, dbType, sqlSessionId, removeStagedChange, executeQuery, pagination, sortColumn, sortDirection, filters, columnMeta])

  const handleDiscardChanges = useCallback(() => {
    // Only remove changes for this table, not all connection changes
    if (tableChanges.length === 0) return // Nothing to discard for this table — skip re-query

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
      if (detail?.connectionId !== connectionId) return
      // If a specific table is targeted, only refresh if it matches this tab
      if (detail.table && detail.table !== table) return
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
    const handleUndoChange = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.connectionId !== connectionId) return
      const changeId = detail.changeId as string
      if (!changeId) return

      // Find the change to determine if we need to refresh (updates/deletes mutate grid data)
      const change = stagedChangesRef.current.find((c) => c.id === changeId)
      if (!change) return

      // Remove the staged change
      removeStagedChange(changeId)
      originalValuesRef.current.delete(changeId)

      // For update/delete changes, the grid data was mutated in-place by ag-grid.
      // We must refresh the data to restore the original values.
      if (change.type === 'update' || change.type === 'delete') {
        cacheKeyRef.current = ''
        executeQuery({
          page: pagination.page,
          pageSize: pagination.pageSize,
          sort: sortColumn,
          sortDir: sortDirection,
          currentFilters: filters,
        })
      }
      // For insert changes, removing from staged is sufficient
      // (the insert row is derived from stagedChanges, not the grid data)
    }

    window.addEventListener('sql:apply-changes', handleApplyChanges)
    window.addEventListener('sql:discard-changes', handleDiscardEvent)
    window.addEventListener('sql:refresh-data', handleRefreshData)
    window.addEventListener('sql:undo-change', handleUndoChange)
    return () => {
      window.removeEventListener('sql:apply-changes', handleApplyChanges)
      window.removeEventListener('sql:discard-changes', handleDiscardEvent)
      window.removeEventListener('sql:refresh-data', handleRefreshData)
      window.removeEventListener('sql:undo-change', handleUndoChange)
    }
  }, [connectionId, handleSaveChanges, handleDiscardChanges, removeStagedChange, executeQuery, pagination, sortColumn, sortDirection, filters])

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
      // Persist FK-navigation filters
      if (filtersKey) {
        try { localStorage.setItem(filtersKey, JSON.stringify(newFilters)) } catch {}
      }
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
    const snapshotQueryId = queryIdRef.current
    const qid = crypto.randomUUID()
    countQueryIdRef.current = qid
    setIsCountLoading(true)
    try {
      const { query: countQuery, params: countParams } = buildCountQuery(table, schema, dbType, filters)
      const countResponse = await (window as any).novadeck.sql.query(sqlSessionId, countQuery, countParams, qid)

      // Guard: if a new table/query started while COUNT(*) was in-flight, discard stale result
      if (snapshotQueryId !== queryIdRef.current) return

      if (countResponse.success) {
        const totalRows = Number(((countResponse.data as QueryResult).rows[0] as any)?.count ?? 0)
        const totalPages = Math.max(1, Math.ceil(totalRows / pagination.pageSize))
        setPagination((prev) => ({ ...prev, totalRows, totalPages, isEstimatedCount: false }))
      }
    } catch {
      // Non-critical — keep the estimated count
    } finally {
      setIsCountLoading(false)
      countQueryIdRef.current = null
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
          externalFocusFilterId={focusFilterId}
          isDataFiltered={isDataFiltered}
        />
      )}

      {/* Error banner — only show data errors in data mode */}
      {isDataMode && error && (
        <div className="shrink-0 border-b border-nd-error/30 bg-nd-error/10 px-3 py-1.5 text-xs text-nd-error">
          {error}
        </div>
      )}

      {/* Data Grid — hidden (not unmounted) when in structure mode to preserve scroll/state */}
      <div className={cn('relative flex-1 overflow-hidden', !isDataMode && 'hidden')}>
        {/* Subtle loading indicator — small spinner in top-right corner inside the relative container */}
        {isLoading && (
          <div className="absolute right-3 top-3 z-10 pointer-events-none">
            <Loader2 size={16} className="animate-spin text-nd-accent" />
          </div>
        )}
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
          onDeleteRows={handleDeleteRows}
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
              prefetchedColumns={columnMeta}
              prefetchedIndexes={indexes}
              prefetchedForeignKeys={foreignKeysRaw}
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
        onInsertRow={handleInsertRow}
      />
    </div>
  )
})

export default DataTabView
