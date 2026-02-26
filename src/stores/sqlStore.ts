import { useCallback, useMemo } from 'react'
import { create } from 'zustand'
import type {
  SQLConnectionStatus,
  DatabaseConnectionConfig,
  SchemaDatabase,
  SchemaTable,
  SchemaColumn,
  SQLTab,
  QueryResult,
  PaginationState,
  TableFilter,
  StagedChange,
  QueryHistoryEntry,
  QueryError,
  TransferProgress,
  RunningQuery
} from '@/types/sql'

// ── Sort state for data grid ──

export interface SortState {
  column: string
  direction: 'asc' | 'desc'
}

// ── Per-connection state slice ──

export interface SQLConnectionSlice {
  // ── Connection ──
  connectionStatus: SQLConnectionStatus
  connectionConfig: DatabaseConnectionConfig | null
  currentDatabase: string
  sqlSessionId: string | null
  tunnelPort: number | null
  connectionError: string | null

  // ── Schema ──
  databases: SchemaDatabase[]
  tables: SchemaTable[]
  selectedTable: string | null
  columns: SchemaColumn[]
  schemaLoading: boolean

  // ── Tabs ──
  tabs: SQLTab[]
  activeTabId: string | null

  // ── Data Grid ──
  queryResult: QueryResult | null
  isQueryLoading: boolean
  pagination: PaginationState
  sort: SortState | null

  // ── Filters ──
  filters: TableFilter[]

  // ── Staged Changes ──
  stagedChanges: StagedChange[]

  // ── Query Editor ──
  currentQuery: string
  queryError: QueryError | null

  // ── History ──
  history: QueryHistoryEntry[]

  // ── Running Queries ──
  runningQueries: RunningQuery[]

  // ── Data Transfer ──
  activeTransfer: TransferProgress | null
  lastTransferResult: TransferProgress | null
}

// ── Store shape ──

interface SQLStoreState {
  connections: Record<string, SQLConnectionSlice>

  // ── Connection actions ──
  setConnectionStatus: (connectionId: string, status: SQLConnectionStatus) => void
  setConnectionConfig: (connectionId: string, config: DatabaseConnectionConfig | null) => void
  setCurrentDatabase: (connectionId: string, database: string) => void
  setSqlSessionId: (connectionId: string, id: string | null) => void
  setTunnelPort: (connectionId: string, port: number | null) => void
  setConnectionError: (connectionId: string, error: string | null) => void

  // ── Schema actions ──
  setDatabases: (connectionId: string, databases: SchemaDatabase[]) => void
  setTables: (connectionId: string, tables: SchemaTable[]) => void
  setSelectedTable: (connectionId: string, table: string | null) => void
  setColumns: (connectionId: string, columns: SchemaColumn[]) => void
  setSchemaLoading: (connectionId: string, loading: boolean) => void

  // ── Tab actions ──
  addTab: (connectionId: string, tab: SQLTab) => void
  removeTab: (connectionId: string, id: string) => void
  /** Remove multiple tabs at once. If the active tab is among them, selects the nearest remaining tab. */
  removeTabs: (connectionId: string, ids: string[]) => void
  setActiveTab: (connectionId: string, id: string) => void
  updateTab: (connectionId: string, id: string, updates: Partial<SQLTab>) => void

  // ── Data Grid actions ──
  setQueryResult: (connectionId: string, result: QueryResult | null) => void
  setIsQueryLoading: (connectionId: string, loading: boolean) => void
  setPagination: (connectionId: string, pagination: Partial<PaginationState>) => void
  setSort: (connectionId: string, sort: SortState | null) => void

  // ── Filter actions ──
  setFilters: (connectionId: string, filters: TableFilter[]) => void
  addFilter: (connectionId: string, filter: TableFilter) => void
  updateFilter: (connectionId: string, id: string, updates: Partial<TableFilter>) => void
  removeFilter: (connectionId: string, id: string) => void
  clearFilters: (connectionId: string) => void

  // ── Staged changes actions ──
  addStagedChange: (connectionId: string, change: StagedChange) => void
  removeStagedChange: (connectionId: string, id: string) => void
  upsertStagedChange: (connectionId: string, change: StagedChange) => void
  clearStagedChanges: (connectionId: string) => void

  // ── Query editor actions ──
  setCurrentQuery: (connectionId: string, query: string) => void
  setQueryError: (connectionId: string, error: QueryError | null) => void

  // ── History actions ──
  addHistoryEntry: (connectionId: string, entry: QueryHistoryEntry) => void
  clearHistory: (connectionId: string) => void
  toggleHistoryFavorite: (connectionId: string, id: string) => void

  // ── Running queries actions ──
  addRunningQuery: (connectionId: string, query: RunningQuery) => void
  removeRunningQuery: (connectionId: string, queryId: string) => void
  clearRunningQueries: (connectionId: string) => void

  // ── Transfer actions ──
  setActiveTransfer: (connectionId: string, progress: TransferProgress | null) => void
  clearLastTransferResult: (connectionId: string) => void

  // ── Reset a single connection ──
  reset: (connectionId: string) => void

  // ── Remove connection entirely ──
  removeConnection: (connectionId: string) => void
}

// ── Defaults ──

const DEFAULT_PAGINATION: PaginationState = {
  page: 1,
  pageSize: 200,
  totalRows: 0,
  totalPages: 0
}

const INITIAL_CONNECTION_STATE: SQLConnectionSlice = {
  connectionStatus: 'disconnected',
  connectionConfig: null,
  currentDatabase: '',
  sqlSessionId: null,
  tunnelPort: null,
  connectionError: null,

  databases: [],
  tables: [],
  selectedTable: null,
  columns: [],
  schemaLoading: false,

  tabs: [],
  activeTabId: null,

  queryResult: null,
  isQueryLoading: false,
  pagination: { ...DEFAULT_PAGINATION },
  sort: null,

  filters: [],

  stagedChanges: [],

  currentQuery: '',
  queryError: null,

  history: [],

  runningQueries: [],

  activeTransfer: null,
  lastTransferResult: null
}

// ── Helpers ──

/** Get connection state or return a fresh initial state. */
function getConn(connections: Record<string, SQLConnectionSlice>, connectionId: string): SQLConnectionSlice {
  return connections[connectionId] ?? { ...INITIAL_CONNECTION_STATE, pagination: { ...DEFAULT_PAGINATION } }
}

/** Produce a new connections record with one connection updated. */
function updateConn(
  connections: Record<string, SQLConnectionSlice>,
  connectionId: string,
  updater: (conn: SQLConnectionSlice) => Partial<SQLConnectionSlice>
): { connections: Record<string, SQLConnectionSlice> } {
  const conn = getConn(connections, connectionId)
  return {
    connections: {
      ...connections,
      [connectionId]: { ...conn, ...updater(conn) }
    }
  }
}

// ── Store ──

export const useSQLStore = create<SQLStoreState>((set) => ({
  connections: {},

  // ── Connection actions ──

  setConnectionStatus: (connectionId, status) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ connectionStatus: status }))),

  setConnectionConfig: (connectionId, config) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ connectionConfig: config }))),

  setCurrentDatabase: (connectionId, database) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ currentDatabase: database }))),

  setSqlSessionId: (connectionId, id) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ sqlSessionId: id }))),

  setTunnelPort: (connectionId, port) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ tunnelPort: port }))),

  setConnectionError: (connectionId, error) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ connectionError: error }))),

  // ── Schema actions ──

  setDatabases: (connectionId, databases) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ databases }))),

  setTables: (connectionId, tables) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ tables }))),

  setSelectedTable: (connectionId, table) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ selectedTable: table }))),

  setColumns: (connectionId, columns) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ columns }))),

  setSchemaLoading: (connectionId, loading) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ schemaLoading: loading }))),

  // ── Tab actions ──

  addTab: (connectionId, tab) =>
    set((s) => updateConn(s.connections, connectionId, (conn) => ({
      tabs: [...conn.tabs, tab],
      activeTabId: tab.id
    }))),

  removeTab: (connectionId, id) =>
    set((s) => updateConn(s.connections, connectionId, (conn) => {
      const idx = conn.tabs.findIndex((t) => t.id === id)
      const newTabs = conn.tabs.filter((t) => t.id !== id)
      let newActiveId = conn.activeTabId

      if (conn.activeTabId === id) {
        if (newTabs.length === 0) {
          newActiveId = null
        } else if (idx >= newTabs.length) {
          newActiveId = newTabs[newTabs.length - 1].id
        } else {
          newActiveId = newTabs[idx].id
        }
      }

      return { tabs: newTabs, activeTabId: newActiveId }
    })),

  removeTabs: (connectionId, ids) =>
    set((s) => updateConn(s.connections, connectionId, (conn) => {
      const idsToRemove = new Set(ids)
      const newTabs = conn.tabs.filter((t) => !idsToRemove.has(t.id))
      let newActiveId = conn.activeTabId

      // If the active tab was removed, pick the nearest remaining tab
      if (newActiveId && idsToRemove.has(newActiveId)) {
        if (newTabs.length === 0) {
          newActiveId = null
        } else {
          // Try to select the tab that was at the same position
          const oldIdx = conn.tabs.findIndex((t) => t.id === newActiveId)
          const clampedIdx = Math.min(oldIdx, newTabs.length - 1)
          newActiveId = newTabs[Math.max(0, clampedIdx)].id
        }
      }

      return { tabs: newTabs, activeTabId: newActiveId }
    })),

  setActiveTab: (connectionId, id) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ activeTabId: id }))),

  updateTab: (connectionId, id, updates) =>
    set((s) => updateConn(s.connections, connectionId, (conn) => ({
      tabs: conn.tabs.map((t) => (t.id === id ? { ...t, ...updates } : t))
    }))),

  // ── Data Grid actions ──

  setQueryResult: (connectionId, result) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ queryResult: result }))),

  setIsQueryLoading: (connectionId, loading) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ isQueryLoading: loading }))),

  setPagination: (connectionId, partial) =>
    set((s) => updateConn(s.connections, connectionId, (conn) => ({
      pagination: { ...conn.pagination, ...partial }
    }))),

  setSort: (connectionId, sort) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ sort }))),

  // ── Filter actions ──

  setFilters: (connectionId, filters) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ filters }))),

  addFilter: (connectionId, filter) =>
    set((s) => updateConn(s.connections, connectionId, (conn) => ({
      filters: [...conn.filters, filter]
    }))),

  updateFilter: (connectionId, id, updates) =>
    set((s) => updateConn(s.connections, connectionId, (conn) => ({
      filters: conn.filters.map((f) => (f.id === id ? { ...f, ...updates } : f))
    }))),

  removeFilter: (connectionId, id) =>
    set((s) => updateConn(s.connections, connectionId, (conn) => ({
      filters: conn.filters.filter((f) => f.id !== id)
    }))),

  clearFilters: (connectionId) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ filters: [] }))),

  // ── Staged changes actions ──

  addStagedChange: (connectionId, change) =>
    set((s) => updateConn(s.connections, connectionId, (conn) => ({
      stagedChanges: [...conn.stagedChanges, change]
    }))),

  removeStagedChange: (connectionId, id) =>
    set((s) => updateConn(s.connections, connectionId, (conn) => ({
      stagedChanges: conn.stagedChanges.filter((c) => c.id !== id)
    }))),

  upsertStagedChange: (connectionId, change) =>
    set((s) => updateConn(s.connections, connectionId, (conn) => {
      const idx = conn.stagedChanges.findIndex((c) => c.id === change.id)
      if (idx >= 0) {
        const updated = [...conn.stagedChanges]
        updated[idx] = change
        return { stagedChanges: updated }
      }
      return { stagedChanges: [...conn.stagedChanges, change] }
    })),

  clearStagedChanges: (connectionId) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ stagedChanges: [] }))),

  // ── Query editor actions ──

  setCurrentQuery: (connectionId, query) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ currentQuery: query }))),

  setQueryError: (connectionId, error) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ queryError: error }))),

  // ── History actions ──

  addHistoryEntry: (connectionId, entry) =>
    set((s) => updateConn(s.connections, connectionId, (conn) => ({
      history: [entry, ...conn.history].slice(0, 500)
    }))),

  clearHistory: (connectionId) =>
    set((s) => updateConn(s.connections, connectionId, (conn) => ({
      history: conn.history.filter((h) => h.isFavorite)
    }))),

  toggleHistoryFavorite: (connectionId, id) =>
    set((s) => updateConn(s.connections, connectionId, (conn) => ({
      history: conn.history.map((h) =>
        h.id === id ? { ...h, isFavorite: !h.isFavorite } : h
      )
    }))),

  // ── Running queries actions ──

  addRunningQuery: (connectionId, query) =>
    set((s) => updateConn(s.connections, connectionId, (conn) => ({
      runningQueries: [...conn.runningQueries, query]
    }))),

  removeRunningQuery: (connectionId, queryId) =>
    set((s) => updateConn(s.connections, connectionId, (conn) => ({
      runningQueries: conn.runningQueries.filter((q) => q.queryId !== queryId)
    }))),

  clearRunningQueries: (connectionId) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ runningQueries: [] }))),

  // ── Transfer actions ──

  setActiveTransfer: (connectionId, progress) =>
    set((s) => updateConn(s.connections, connectionId, () => {
      if (progress && (progress.status === 'completed' || progress.status === 'failed' || progress.status === 'cancelled')) {
        return { activeTransfer: null, lastTransferResult: progress }
      }
      return { activeTransfer: progress }
    })),

  clearLastTransferResult: (connectionId) =>
    set((s) => updateConn(s.connections, connectionId, () => ({ lastTransferResult: null }))),

  // ── Reset a single connection to initial state ──

  reset: (connectionId) =>
    set((s) => ({
      connections: {
        ...s.connections,
        [connectionId]: { ...INITIAL_CONNECTION_STATE, pagination: { ...DEFAULT_PAGINATION } }
      }
    })),

  // ── Remove a connection entirely ──

  removeConnection: (connectionId) =>
    set((s) => {
      const { [connectionId]: _, ...rest } = s.connections
      return { connections: rest }
    })
}))

// ── Imperative access helper (for use in callbacks, effects, non-React code) ──

export function getSQLConnectionState(connectionId: string): SQLConnectionSlice {
  return getConn(useSQLStore.getState().connections, connectionId)
}

// ── Convenience hook — provides per-connection state + bound actions ──

export function useSQLConnection(connectionId: string) {
  const conn = useSQLStore(
    useCallback((s: SQLStoreState) => s.connections[connectionId], [connectionId])
  )

  // Stable actions bound to this connectionId
  const actions = useMemo(() => {
    const s = useSQLStore.getState()
    return {
      setConnectionStatus: (status: SQLConnectionStatus) => s.setConnectionStatus(connectionId, status),
      setConnectionConfig: (config: DatabaseConnectionConfig | null) => s.setConnectionConfig(connectionId, config),
      setCurrentDatabase: (database: string) => s.setCurrentDatabase(connectionId, database),
      setSqlSessionId: (id: string | null) => s.setSqlSessionId(connectionId, id),
      setTunnelPort: (port: number | null) => s.setTunnelPort(connectionId, port),
      setConnectionError: (error: string | null) => s.setConnectionError(connectionId, error),

      setDatabases: (databases: SchemaDatabase[]) => s.setDatabases(connectionId, databases),
      setTables: (tables: SchemaTable[]) => s.setTables(connectionId, tables),
      setSelectedTable: (table: string | null) => s.setSelectedTable(connectionId, table),
      setColumns: (columns: SchemaColumn[]) => s.setColumns(connectionId, columns),
      setSchemaLoading: (loading: boolean) => s.setSchemaLoading(connectionId, loading),

      addTab: (tab: SQLTab) => s.addTab(connectionId, tab),
      removeTab: (id: string) => s.removeTab(connectionId, id),
      removeTabs: (ids: string[]) => s.removeTabs(connectionId, ids),
      setActiveTab: (id: string) => s.setActiveTab(connectionId, id),
      updateTab: (id: string, updates: Partial<SQLTab>) => s.updateTab(connectionId, id, updates),

      setQueryResult: (result: QueryResult | null) => s.setQueryResult(connectionId, result),
      setIsQueryLoading: (loading: boolean) => s.setIsQueryLoading(connectionId, loading),
      setPagination: (pagination: Partial<PaginationState>) => s.setPagination(connectionId, pagination),
      setSort: (sort: SortState | null) => s.setSort(connectionId, sort),

      setFilters: (filters: TableFilter[]) => s.setFilters(connectionId, filters),
      addFilter: (filter: TableFilter) => s.addFilter(connectionId, filter),
      updateFilter: (id: string, updates: Partial<TableFilter>) => s.updateFilter(connectionId, id, updates),
      removeFilter: (id: string) => s.removeFilter(connectionId, id),
      clearFilters: () => s.clearFilters(connectionId),

      addStagedChange: (change: StagedChange) => s.addStagedChange(connectionId, change),
      removeStagedChange: (id: string) => s.removeStagedChange(connectionId, id),
      upsertStagedChange: (change: StagedChange) => s.upsertStagedChange(connectionId, change),
      clearStagedChanges: () => s.clearStagedChanges(connectionId),

      setCurrentQuery: (query: string) => s.setCurrentQuery(connectionId, query),
      setQueryError: (error: QueryError | null) => s.setQueryError(connectionId, error),

      addHistoryEntry: (entry: QueryHistoryEntry) => s.addHistoryEntry(connectionId, entry),
      clearHistory: () => s.clearHistory(connectionId),
      toggleHistoryFavorite: (id: string) => s.toggleHistoryFavorite(connectionId, id),

      addRunningQuery: (query: RunningQuery) => s.addRunningQuery(connectionId, query),
      removeRunningQuery: (queryId: string) => s.removeRunningQuery(connectionId, queryId),
      clearRunningQueries: () => s.clearRunningQueries(connectionId),

      setActiveTransfer: (progress: TransferProgress | null) => s.setActiveTransfer(connectionId, progress),
      clearLastTransferResult: () => s.clearLastTransferResult(connectionId),

      reset: () => s.reset(connectionId),
      removeConnection: () => s.removeConnection(connectionId),
    }
  }, [connectionId])

  // Merge connection state (with defaults for uninitialized connections) + actions
  const state = conn ?? INITIAL_CONNECTION_STATE

  return useMemo(() => ({ ...state, ...actions }), [state, actions])
}
