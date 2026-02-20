// ── Database connection config ──

export type DatabaseType = 'mysql' | 'postgres'

export interface DatabaseConnectionConfig {
  id: string
  name: string
  type: DatabaseType
  host: string
  port: number
  username: string
  password: string
  database: string
  useSSHTunnel: boolean
  ssl?: boolean
  isProduction?: boolean
}

// ── Schema introspection ──

export interface SchemaDatabase {
  name: string
  isActive: boolean
}

export interface SchemaTable {
  name: string
  type: 'table' | 'view'
  schema?: string
  rowCount?: number
}

export interface SchemaColumn {
  name: string
  type: string
  nullable: boolean
  defaultValue: string | null
  isPrimaryKey: boolean
  isAutoIncrement: boolean
  extra?: string
  comment?: string
}

export interface SchemaIndex {
  name: string
  columns: string[]
  isUnique: boolean
  isPrimary: boolean
  type: string
}

export interface SchemaForeignKey {
  name: string
  columns: string[]
  referencedTable: string
  referencedColumns: string[]
  onUpdate: string
  onDelete: string
}

// ── Query execution ──

export interface QueryField {
  name: string
  type: string
  table?: string
}

export interface QueryResult {
  fields: QueryField[]
  rows: Record<string, unknown>[]
  rowCount: number
  affectedRows?: number
  executionTimeMs: number
  truncated: boolean
  totalRowEstimate?: number
}

export interface QueryError {
  message: string
  code?: string
  position?: number
  line?: number
}

// ── Pagination ──

export interface PaginationState {
  page: number
  pageSize: number
  totalRows: number
  totalPages: number
}

// ── Filters (TablePlus-style) ──

export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'greater_or_equal'
  | 'less_or_equal'
  | 'is_null'
  | 'is_not_null'
  | 'in'
  | 'not_in'
  | 'between'
  | 'raw_sql'

export interface TableFilter {
  id: string
  enabled: boolean
  column: string
  operator: FilterOperator
  value: string
  value2?: string
}

// ── Staged changes (inline editing) ──

export type ChangeType = 'update' | 'insert' | 'delete'

export interface StagedChange {
  id: string
  type: ChangeType
  table: string
  schema?: string
  primaryKey?: Record<string, unknown>
  /** Row data at the time of edit (used to build WHERE clause) */
  rowData?: Record<string, unknown>
  /** Column-level changes for updates */
  column?: string
  oldValue?: unknown
  newValue?: unknown
  changes?: Record<string, { old: unknown; new: unknown }>
  newRow?: Record<string, unknown>
  sql?: string
}

// ── Query history ──

export interface QueryHistoryEntry {
  id: string
  query: string
  database: string
  executedAt: number
  executionTimeMs: number
  rowCount?: number
  error?: string
  isFavorite: boolean
}

// ── Connection state ──

export type SQLConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface SQLConnectionState {
  status: SQLConnectionStatus
  config?: DatabaseConnectionConfig
  currentDatabase: string
  error?: string
  tunnelPort?: number
  tunnelRuleId?: string
}

// ── Tab management ──

export type SQLTabType = 'data' | 'query' | 'structure'

export interface SQLTab {
  id: string
  type: SQLTabType
  label: string
  table?: string
  schema?: string
  query?: string
  isDirty?: boolean
}
