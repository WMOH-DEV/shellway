// ── Database connection config ──

export type DatabaseType = "mysql" | "postgres";
export type SSLMode = "disabled" | "preferred" | "required" | "verify-full";
export type ConnectionTag =
  | "none"
  | "development"
  | "staging"
  | "production"
  | "testing";

export interface DatabaseConnectionConfig {
  id: string;
  name: string;
  type: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  useSSHTunnel: boolean;
  ssl?: boolean;
  sslMode?: SSLMode;
  isProduction?: boolean;
  tag?: ConnectionTag;
  connectionName?: string;
}

// ── Schema introspection ──

export interface SchemaDatabase {
  name: string;
  isActive: boolean;
}

export interface SchemaTable {
  name: string;
  type: "table" | "view";
  schema?: string;
  rowCount?: number;
}

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
  extra?: string;
  comment?: string;
  /** Table this column belongs to — used for autocomplete */
  tableName?: string;
  /** Ordinal position (1-based) */
  ordinalPosition?: number;
  /** Character set (MySQL only) */
  charset?: string | null;
  /** Collation name */
  collation?: string | null;
  /** Column key indicator: 'PRI', 'UNI', 'MUL', '' */
  columnKey?: string;
  /** Identity generation (PostgreSQL): 'ALWAYS' | 'BY DEFAULT' | null */
  identityGeneration?: string | null;
  /** Whether the column is generated (stored/virtual) */
  isGenerated?: boolean;
  /** Generation expression for computed columns */
  generationExpression?: string | null;
}

/** Full column metadata used by the Structure view for editing */
export interface StructureColumn {
  /** Unique ID for tracking in the UI */
  _uid: string;
  /** 'existing' | 'added' — tracks if this is a new column */
  _status: "existing" | "added";
  /** Whether this column has been modified from its original state */
  _modified: boolean;
  /** Whether this column is marked for deletion */
  _deleted: boolean;
  /** Original column name (for rename detection) */
  _originalName: string | null;
  /** Original column data before edits (for diff generation) */
  _original: Omit<
    StructureColumn,
    | "_uid"
    | "_status"
    | "_modified"
    | "_deleted"
    | "_originalName"
    | "_original"
  > | null;

  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
  extra: string;
  comment: string;
  ordinalPosition: number;
  charset: string | null;
  collation: string | null;
  columnKey: string;
  identityGeneration: string | null;
  isGenerated: boolean;
  generationExpression: string | null;
}

export interface SchemaIndex {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  type: string;
}

export interface SchemaForeignKey {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onUpdate: string;
  onDelete: string;
}

// ── Query execution ──

export interface QueryField {
  name: string;
  type: string;
  table?: string;
}

export interface QueryResult {
  fields: QueryField[];
  rows: Record<string, unknown>[];
  rowCount: number;
  affectedRows?: number;
  executionTimeMs: number;
  truncated: boolean;
  totalRowEstimate?: number;
}

export interface QueryError {
  message: string;
  code?: string;
  position?: number;
  line?: number;
}

// ── Pagination ──

export interface PaginationState {
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  /** When true, totalRows is an estimate from DB statistics (not an exact COUNT(*)) */
  isEstimatedCount?: boolean;
  /**
   * When true, the total row count is unknown — no COUNT(*) has been run and
   * totalRows is only a lower-bound sentinel used to keep the Next button
   * enabled. UI should render range-only ("1-200 rows") instead of a totals
   * ("1-200 of ~X rows") and hide the "of Y pages" suffix.
   */
  isUnknownTotal?: boolean;
}

// ── Filters (TablePlus-style) ──

export type FilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "greater_than"
  | "less_than"
  | "greater_or_equal"
  | "less_or_equal"
  | "is_null"
  | "is_not_null"
  | "in"
  | "not_in"
  | "between"
  | "raw_sql";

export interface TableFilter {
  id: string;
  enabled: boolean;
  column: string;
  operator: FilterOperator;
  value: string;
  value2?: string;
}

// ── Sort ──

export interface SortKey {
  column: string;
  direction: "asc" | "desc";
}

// ── Staged changes (inline editing) ──

export type ChangeType = "update" | "insert" | "delete";

export interface StagedChange {
  id: string;
  type: ChangeType;
  table: string;
  schema?: string;
  primaryKey?: Record<string, unknown>;
  /** Row data at the time of edit (used to build WHERE clause) */
  rowData?: Record<string, unknown>;
  /** Column-level changes for updates */
  column?: string;
  oldValue?: unknown;
  newValue?: unknown;
  changes?: Record<string, { old: unknown; new: unknown }>;
  newRow?: Record<string, unknown>;
  sql?: string;
}

// ── Query history ──

export interface QueryHistoryEntry {
  id: string;
  query: string;
  database: string;
  executedAt: number;
  executionTimeMs: number;
  rowCount?: number;
  error?: string;
  isFavorite: boolean;
}

// ── Connection state ──

export type SQLConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface SQLConnectionState {
  status: SQLConnectionStatus;
  config?: DatabaseConnectionConfig;
  currentDatabase: string;
  error?: string;
  tunnelPort?: number;
  tunnelRuleId?: string;
}

// ── Tab management ──

export type SQLTabType = "data" | "query" | "structure";

export interface SQLTab {
  id: string;
  type: SQLTabType;
  label: string;
  table?: string;
  schema?: string;
  query?: string;
  isDirty?: boolean;
  /** Index into the saved-queries stack (for query tabs). Used to persist
   *  and restore editor content across app restarts.  -1 = not yet assigned. */
  savedQueryIndex?: number;
}

// ── Running Queries ──

export interface RunningQuery {
  queryId: string;
  sqlSessionId: string;
  query: string;
  startedAt: number;
  /** Source of the query: 'data' = DataTabView, 'editor' = QueryEditor, 'internal' = schema/metadata */
  source: "data" | "editor" | "internal";
  /** Table name if this query was triggered by a data tab */
  table?: string;
}

// ── Data Transfer ──

export type TransferOperation = "export" | "import" | "backup" | "restore";
export type TransferStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

export interface TransferStats {
  /** Statements/rows that executed successfully on first try */
  executed: number;
  /** Errors resolved via a heal transformation */
  healed: number;
  /** Errors skipped (user opted to skip, or auto-skip policy) */
  skipped: number;
  /** Statements written to the quarantine file */
  quarantined: number;
  /** Fatal errors (after abort) */
  failed: number;
}

export interface TransferProgress {
  operationId: string;
  sqlSessionId: string;
  operation: TransferOperation;
  status: TransferStatus;
  /** 0-100, or -1 for indeterminate */
  percentage: number;
  processedRows?: number;
  totalRows?: number;
  processedBytes?: number;
  totalBytes?: number;
  currentTable?: string;
  message?: string;
  error?: string;
  /** Preview of the statement currently executing (truncated). */
  currentStatement?: string;
  /** Cumulative outcome tally for the run. */
  stats?: TransferStats;
  /** Path to the quarantine file, if any statements were quarantined. */
  quarantinePath?: string;
  startedAt: number;
  completedAt?: number;
}

// ── Healing: run modes, error taxonomy, decisions ──

/** How the import/restore loop reacts to a failing statement. */
export type HealRunMode =
  /** Apply the recommended heal for every error, no prompts. */
  | "full-auto"
  /** Auto-heal low-risk classes, ask on high-risk ones. Default. */
  | "smart"
  /** Pause on every error and wait for the user. */
  | "ask-always"
  /** Stop on the first error (preserves old abort behaviour). */
  | "strict-abort";

/** Canonical taxonomy of driver errors the healing engine knows how to treat. */
export type HealErrorClass =
  | "syntax"
  | "duplicate-key"
  | "fk-violation"
  | "not-null-violation"
  | "data-too-long"
  | "type-mismatch"
  | "bad-default"
  | "unknown-column"
  | "unknown-table"
  | "table-exists"
  | "duplicate-constraint"
  | "charset"
  | "privileges"
  | "lock-wait"
  | "connection-lost"
  | "disk-or-memory"
  | "unknown";

/** All heal actions the engine can take at the statement level. */
export type HealStrategy =
  // Control-level decisions (always available)
  | "retry-as-is"
  | "retry-with-edit"
  | "skip"
  | "quarantine"
  | "abort"
  // duplicate-key
  | "insert-ignore"
  | "replace-into"
  | "on-conflict-nothing"
  | "on-conflict-update"
  // fk-violation
  | "disable-fk-checks"
  | "defer-fk"
  // not-null / bad-default / type-mismatch
  | "strip-default"
  | "substitute-default"
  | "make-nullable"
  | "coerce-type"
  | "set-null-on-value"
  // data-too-long
  | "truncate-value"
  | "widen-column"
  // table-exists / unknown-table
  | "drop-if-exists"
  | "if-not-exists"
  | "create-table-stub"
  // duplicate-constraint
  | "strip-constraint-name"
  // unknown-column
  | "remove-column-ref"
  | "add-column"
  // charset
  | "reencode-utf8"
  | "strip-invalid-chars"
  // transient
  | "retry-with-backoff"
  | "reconnect-and-retry";

/** A heal option offered to the user for a given error class. */
export interface HealOptionDescriptor {
  strategy: HealStrategy;
  label: string;
  description: string;
  /** Mark the heal shown first in UI and applied automatically in Full Auto / Smart (for safe classes). */
  recommended?: boolean;
  /** Heal rewrites schema (ALTER TABLE). Higher blast radius — Smart mode asks. */
  schemaMutation?: boolean;
  /** Heal mutates data values (truncate, substitute). */
  dataMutation?: boolean;
}

/** Payload emitted to the renderer when a statement fails and needs a decision. */
export interface ResolutionRequest {
  operationId: string;
  sqlSessionId: string;
  /** 1-based index within the import (statement number). */
  statementIndex: number;
  /** Full failing statement (may be long; renderer truncates for preview). */
  statement: string;
  errorClass: HealErrorClass;
  errorMessage: string;
  /** Driver-native error code (e.g. ER_DUP_ENTRY, 23505). */
  errorCode?: string | number;
  /** Heals available for this error class. */
  availableStrategies: HealOptionDescriptor[];
}

/** The user's (or auto-mode's) response to a ResolutionRequest. */
export interface HealDecision {
  /** Umbrella action. When 'heal', `strategy` specifies which transform to apply. */
  action: "heal" | "skip" | "quarantine" | "abort" | "retry";
  /** The heal transform. Required when action === 'heal'. */
  strategy?: HealStrategy;
  /** User-edited SQL when action === 'retry'. */
  editedStatement?: string;
  /** Extra parameter (e.g. substitute value, widen target size). */
  param?: string | number;
  /** Persist this decision for all subsequent errors of the same class in this run. */
  rememberForClass?: boolean;
}
