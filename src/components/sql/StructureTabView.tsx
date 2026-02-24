import { memo, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Columns3,
  ListTree,
  Link2,
  Plus,
  Trash2,
  Undo2,
  Save,
  Eye,
  AlertTriangle,
  Key,
  Zap,
  Copy,
  Check,
  Pencil,
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Tooltip } from '@/components/ui/Tooltip'
import type {
  SchemaColumn,
  SchemaIndex,
  SchemaForeignKey,
  StructureColumn,
  DatabaseType,
} from '@/types/sql'

// ── Props ──

interface StructureTabViewProps {
  sqlSessionId: string
  table: string
  schema?: string
  dbType: DatabaseType
  /** Unused — reserved for future features like refresh event binding */
  connectionId?: string
  /** Pre-fetched column metadata from DataTabView — avoids cold-start query on first visit */
  prefetchedColumns?: SchemaColumn[]
  /** Pre-fetched index metadata from DataTabView */
  prefetchedIndexes?: SchemaIndex[]
  /** Pre-fetched foreign key metadata from DataTabView */
  prefetchedForeignKeys?: SchemaForeignKey[]
}

// ── Constants ──

const MYSQL_TYPES = [
  'tinyint', 'smallint', 'mediumint', 'int', 'bigint',
  'float', 'double', 'decimal', 'numeric',
  'char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext',
  'binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob',
  'date', 'time', 'datetime', 'timestamp', 'year',
  'boolean', 'bool',
  'json', 'enum', 'set',
  'bit',
  'geometry', 'point', 'linestring', 'polygon',
]

const POSTGRES_TYPES = [
  'smallint', 'integer', 'bigint', 'serial', 'bigserial',
  'real', 'double precision', 'numeric', 'decimal', 'money',
  'char', 'varchar', 'character varying', 'text',
  'bytea',
  'date', 'time', 'timestamp', 'timestamptz', 'interval',
  'boolean',
  'json', 'jsonb',
  'uuid',
  'inet', 'cidr', 'macaddr',
  'point', 'line', 'lseg', 'box', 'path', 'polygon', 'circle',
  'int4range', 'int8range', 'numrange', 'tsrange', 'tstzrange', 'daterange',
  'xml',
  'tsvector', 'tsquery',
  'array',
]

// ── Helpers ──

function generateUid(): string {
  return crypto.randomUUID()
}

function quoteId(name: string, dbType: DatabaseType): string {
  if (dbType === 'mysql') return `\`${name.replace(/`/g, '``')}\``
  return `"${name.replace(/"/g, '""')}"`
}

function schemaColumnToStructure(col: SchemaColumn, idx: number): StructureColumn {
  const base = {
    name: col.name,
    type: col.type,
    nullable: col.nullable,
    defaultValue: col.defaultValue,
    isPrimaryKey: col.isPrimaryKey,
    isAutoIncrement: col.isAutoIncrement,
    extra: col.extra || '',
    comment: col.comment || '',
    ordinalPosition: col.ordinalPosition ?? idx + 1,
    charset: col.charset ?? null,
    collation: col.collation ?? null,
    columnKey: col.columnKey || (col.isPrimaryKey ? 'PRI' : ''),
    identityGeneration: col.identityGeneration ?? null,
    isGenerated: col.isGenerated ?? false,
    generationExpression: col.generationExpression ?? null,
  }

  return {
    ...base,
    _uid: generateUid(),
    _status: 'existing',
    _modified: false,
    _deleted: false,
    _originalName: col.name,
    _original: { ...base },
  }
}

function createEmptyColumn(position: number, dbType: DatabaseType): StructureColumn {
  return {
    _uid: generateUid(),
    _status: 'added',
    _modified: false,
    _deleted: false,
    _originalName: null,
    _original: null,
    name: '',
    type: dbType === 'mysql' ? 'varchar(255)' : 'varchar(255)',
    nullable: true,
    defaultValue: null,
    isPrimaryKey: false,
    isAutoIncrement: false,
    extra: '',
    comment: '',
    ordinalPosition: position,
    charset: null,
    collation: null,
    columnKey: '',
    identityGeneration: null,
    isGenerated: false,
    generationExpression: null,
  }
}

/** Check if a StructureColumn has changed from its original */
function isColumnModified(col: StructureColumn): boolean {
  if (col._status === 'added') return true
  if (!col._original) return false
  const o = col._original
  return (
    col.name !== o.name ||
    col.type !== o.type ||
    col.nullable !== o.nullable ||
    col.defaultValue !== o.defaultValue ||
    col.isPrimaryKey !== o.isPrimaryKey ||
    col.isAutoIncrement !== o.isAutoIncrement ||
    col.comment !== o.comment ||
    col.charset !== o.charset ||
    col.collation !== o.collation
  )
}

// ── DDL generation ──

function generateAlterStatements(
  table: string,
  schema: string | undefined,
  columns: StructureColumn[],
  dbType: DatabaseType
): string[] {
  const statements: string[] = []
  const fullTable = schema
    ? `${quoteId(schema, dbType)}.${quoteId(table, dbType)}`
    : quoteId(table, dbType)

  // 1. Collect deleted columns
  const deleted = columns.filter((c) => c._deleted && c._status === 'existing')
  // 2. Collect modified columns (existing, not deleted)
  const modified = columns.filter(
    (c) => !c._deleted && c._status === 'existing' && isColumnModified(c)
  )
  // 3. Collect added columns
  const added = columns.filter((c) => c._status === 'added' && !c._deleted)

  if (dbType === 'mysql') {
    const parts: string[] = []

    // Drops
    for (const col of deleted) {
      parts.push(`  DROP COLUMN ${quoteId(col._originalName!, dbType)}`)
    }

    // Modifications
    for (const col of modified) {
      if (col._originalName && col.name !== col._originalName) {
        // Rename + modify
        parts.push(
          `  CHANGE COLUMN ${quoteId(col._originalName, dbType)} ${quoteId(col.name, dbType)} ${buildMySQLColumnDef(col)}`
        )
      } else {
        parts.push(
          `  MODIFY COLUMN ${quoteId(col.name, dbType)} ${buildMySQLColumnDef(col)}`
        )
      }
    }

    // Additions
    for (const col of added) {
      if (!col.name.trim()) continue
      parts.push(
        `  ADD COLUMN ${quoteId(col.name, dbType)} ${buildMySQLColumnDef(col)}`
      )
    }

    if (parts.length > 0) {
      statements.push(`ALTER TABLE ${fullTable}\n${parts.join(',\n')};`)
    }
  } else {
    // PostgreSQL — each operation is a separate sub-command
    const parts: string[] = []

    // Drops
    for (const col of deleted) {
      parts.push(`  DROP COLUMN ${quoteId(col._originalName!, dbType)}`)
    }

    // Additions
    for (const col of added) {
      if (!col.name.trim()) continue
      parts.push(
        `  ADD COLUMN ${quoteId(col.name, dbType)} ${buildPostgresColumnDef(col)}`
      )
    }

    // Modifications — PostgreSQL needs separate ALTER COLUMN clauses
    for (const col of modified) {
      const orig = col._original!

      // Rename
      if (col._originalName && col.name !== col._originalName) {
        statements.push(
          `ALTER TABLE ${fullTable} RENAME COLUMN ${quoteId(col._originalName, dbType)} TO ${quoteId(col.name, dbType)};`
        )
      }

      const colRef = quoteId(col.name, dbType)

      // Type change
      if (col.type !== orig.type) {
        parts.push(`  ALTER COLUMN ${colRef} TYPE ${col.type}`)
      }

      // Nullable change
      if (col.nullable !== orig.nullable) {
        parts.push(
          col.nullable
            ? `  ALTER COLUMN ${colRef} DROP NOT NULL`
            : `  ALTER COLUMN ${colRef} SET NOT NULL`
        )
      }

      // Default change
      if (col.defaultValue !== orig.defaultValue) {
        if (col.defaultValue === null || col.defaultValue === '') {
          parts.push(`  ALTER COLUMN ${colRef} DROP DEFAULT`)
        } else {
          parts.push(`  ALTER COLUMN ${colRef} SET DEFAULT ${col.defaultValue}`)
        }
      }
    }

    if (parts.length > 0) {
      statements.push(`ALTER TABLE ${fullTable}\n${parts.join(',\n')};`)
    }

    // Comments — PostgreSQL uses COMMENT ON COLUMN (always schema-qualify)
    const pgSchema = schema || 'public'
    for (const col of modified) {
      const orig = col._original!
      if (col.comment !== orig.comment) {
        const commentVal = col.comment ? `'${col.comment.replace(/'/g, "''")}'` : 'NULL'
        const colPath = `${quoteId(pgSchema, dbType)}.${quoteId(table, dbType)}.${quoteId(col.name, dbType)}`
        statements.push(`COMMENT ON COLUMN ${colPath} IS ${commentVal};`)
      }
    }

    // Comments for new columns
    for (const col of added) {
      if (!col.name.trim() || !col.comment) continue
      const commentVal = `'${col.comment.replace(/'/g, "''")}'`
      const colPath = `${quoteId(pgSchema, dbType)}.${quoteId(table, dbType)}.${quoteId(col.name, dbType)}`
      statements.push(`COMMENT ON COLUMN ${colPath} IS ${commentVal};`)
    }
  }

  return statements
}

/** Validate identifier-like values (charset, collation) — only allow safe characters */
function isSafeIdentifier(value: string): boolean {
  return /^[a-zA-Z0-9_]+$/.test(value)
}

function buildMySQLColumnDef(col: StructureColumn): string {
  let def = col.type

  if (col.charset && isSafeIdentifier(col.charset)) def += ` CHARACTER SET ${col.charset}`
  if (col.collation && isSafeIdentifier(col.collation)) def += ` COLLATE ${col.collation}`

  if (!col.nullable) def += ' NOT NULL'
  else def += ' NULL'

  if (col.isAutoIncrement) {
    def += ' AUTO_INCREMENT'
  } else if (col.defaultValue !== null && col.defaultValue !== '') {
    // Check if default needs quoting (expressions like CURRENT_TIMESTAMP don't)
    const noQuote = /^(CURRENT_TIMESTAMP|NOW\(\)|NULL|TRUE|FALSE|\d+(\.\d+)?|b'[01]+')$/i
    if (noQuote.test(col.defaultValue.trim())) {
      def += ` DEFAULT ${col.defaultValue}`
    } else {
      def += ` DEFAULT '${col.defaultValue.replace(/'/g, "''")}'`
    }
  }

  if (col.comment) {
    def += ` COMMENT '${col.comment.replace(/'/g, "''")}'`
  }

  return def
}

function buildPostgresColumnDef(col: StructureColumn): string {
  let def = col.type

  if (!col.nullable) def += ' NOT NULL'

  if (col.defaultValue !== null && col.defaultValue !== '') {
    // Expressions that don't need quoting (functions, keywords, numbers)
    const noQuote = /^(CURRENT_TIMESTAMP|NOW\(\)|NULL|TRUE|FALSE|gen_random_uuid\(\)|nextval\(.*\)|\d+(\.\d+)?)$/i
    if (noQuote.test(col.defaultValue.trim())) {
      def += ` DEFAULT ${col.defaultValue}`
    } else {
      def += ` DEFAULT '${col.defaultValue.replace(/'/g, "''")}'`
    }
  }

  return def
}

// ── Key badge helpers ──

interface KeyBadge {
  label: string
  variant: 'info' | 'accent' | 'success' | 'warning' | 'default'
  icon?: React.ReactNode
}

function getColumnBadges(col: StructureColumn, fkColumns: string[]): KeyBadge[] {
  const badges: KeyBadge[] = []
  if (col.isPrimaryKey || col.columnKey === 'PRI')
    badges.push({ label: 'PK', variant: 'info', icon: <Key size={9} /> })
  if (col.isAutoIncrement)
    badges.push({ label: 'AI', variant: 'accent', icon: <Zap size={9} /> })
  if (col.columnKey === 'UNI')
    badges.push({ label: 'UNI', variant: 'success' })
  if (fkColumns.includes(col.name))
    badges.push({ label: 'FK', variant: 'warning', icon: <Link2 size={9} /> })
  return badges
}

// ── Collapsible section ──

interface SectionProps {
  title: string
  icon: React.ReactNode
  count: number
  defaultOpen?: boolean
  children: React.ReactNode
  actions?: React.ReactNode
}

const Section = memo(function Section({
  title,
  icon,
  count,
  defaultOpen = true,
  children,
  actions,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const toggle = useCallback(() => setOpen((o) => !o), [])

  return (
    <div className="border border-nd-border rounded-md overflow-hidden">
      <div className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold text-nd-text-primary bg-nd-surface">
        <button
          onClick={toggle}
          className="flex items-center gap-2 flex-1 hover:text-nd-accent transition-colors text-left"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {icon}
          <span>{title}</span>
          <Badge variant="default" className="ml-1">
            {count}
          </Badge>
        </button>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      {open && <div className="border-t border-nd-border">{children}</div>}
    </div>
  )
})

// ── Inline editable cell ──

interface EditableCellProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  mono?: boolean
  disabled?: boolean
  suggestions?: string[]
}

function EditableCell({
  value,
  onChange,
  placeholder,
  className,
  mono,
  disabled,
  suggestions,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [localValue, setLocalValue] = useState(value)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const filteredSuggestions = useMemo(() => {
    if (!suggestions || !localValue) return suggestions || []
    const lower = localValue.toLowerCase()
    return suggestions.filter((s) => s.toLowerCase().includes(lower)).slice(0, 12)
  }, [suggestions, localValue])

  const commit = useCallback(() => {
    setEditing(false)
    setShowSuggestions(false)
    if (localValue !== value) onChange(localValue)
  }, [localValue, value, onChange])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commit()
      } else if (e.key === 'Escape') {
        setLocalValue(value)
        setEditing(false)
        setShowSuggestions(false)
      } else if (e.key === 'Tab') {
        commit()
      }
    },
    [commit, value]
  )

  if (disabled) {
    return (
      <span
        className={cn(
          'block truncate px-2 py-1 text-nd-text-muted',
          mono && 'font-mono',
          className
        )}
      >
        {value || <span className="opacity-40">{placeholder}</span>}
      </span>
    )
  }

  if (!editing) {
    return (
      <button
        className={cn(
          'block w-full text-left truncate px-2 py-1 rounded-sm',
          'hover:bg-nd-accent/10 transition-colors cursor-text',
          mono && 'font-mono',
          !value && 'text-nd-text-muted italic',
          className
        )}
        onClick={() => setEditing(true)}
        onDoubleClick={() => setEditing(true)}
      >
        {value || placeholder || '—'}
      </button>
    )
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={localValue}
        onChange={(e) => {
          setLocalValue(e.target.value)
          if (suggestions) setShowSuggestions(true)
        }}
        onBlur={() => {
          // Small delay so clicking a suggestion works
          setTimeout(commit, 150)
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => suggestions && setShowSuggestions(true)}
        placeholder={placeholder}
        className={cn(
          'w-full h-7 px-2 py-0.5 rounded-sm text-xs border',
          'bg-nd-surface border-nd-accent text-nd-text-primary',
          'focus:outline-none focus:ring-1 focus:ring-nd-accent',
          mono && 'font-mono',
          className
        )}
      />
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 max-h-40 overflow-y-auto rounded-md border border-nd-border bg-nd-bg-secondary shadow-lg">
          {filteredSuggestions.map((s) => (
            <button
              key={s}
              className="block w-full text-left px-2.5 py-1 text-xs font-mono text-nd-text-primary hover:bg-nd-surface-hover transition-colors"
              onMouseDown={(e) => {
                e.preventDefault()
                setLocalValue(s)
                onChange(s)
                setEditing(false)
                setShowSuggestions(false)
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Nullable toggle ──

function NullableToggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      className={cn(
        'px-2 py-0.5 rounded-full text-2xs font-semibold border transition-all',
        value
          ? 'bg-nd-warning/15 text-nd-warning border-nd-warning/30 hover:bg-nd-warning/25'
          : 'bg-nd-success/15 text-nd-success border-nd-success/30 hover:bg-nd-success/25',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      title={value ? 'NULL allowed — click to make NOT NULL' : 'NOT NULL — click to allow NULL'}
    >
      {value ? 'NULL' : 'NOT NULL'}
    </button>
  )
}

// ── PK toggle ──

function PKToggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      className={cn(
        'w-5 h-5 rounded flex items-center justify-center transition-all',
        value
          ? 'bg-nd-info/20 text-nd-info border border-nd-info/40'
          : 'bg-nd-surface text-nd-text-muted border border-nd-border hover:border-nd-info/40',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      title={value ? 'Primary Key — click to remove' : 'Click to set as Primary Key'}
    >
      <Key size={10} />
    </button>
  )
}

// ── Loading skeleton ──

function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="p-3 space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-7 bg-nd-surface animate-pulse rounded" />
      ))}
    </div>
  )
}

// ── FK action badge ──

function FKActionBadge({ action }: { action: string }) {
  const upper = action.toUpperCase()
  let variant: 'error' | 'warning' | 'info' | 'default' = 'default'
  if (upper === 'CASCADE') variant = 'error'
  else if (upper === 'SET NULL') variant = 'warning'
  else if (upper === 'RESTRICT' || upper === 'NO ACTION') variant = 'info'
  return <Badge variant={variant}>{upper}</Badge>
}

// ── DDL Preview Modal ──

interface DDLPreviewModalProps {
  open: boolean
  onClose: () => void
  onExecute: () => void
  statements: string[]
  executing: boolean
}

function DDLPreviewModal({
  open,
  onClose,
  onExecute,
  statements,
  executing,
}: DDLPreviewModalProps) {
  const [copied, setCopied] = useState(false)
  const fullSQL = statements.join('\n\n')

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(fullSQL)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [fullSQL])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Review Structure Changes"
      maxWidth="max-w-2xl"
      closeOnBackdrop={!executing}
      closeOnEscape={!executing}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs text-nd-warning">
          <AlertTriangle size={14} />
          <span>
            Review the SQL below carefully. These changes will be applied to
            your database.
          </span>
        </div>

        <div className="relative">
          <pre className="p-4 rounded-md bg-nd-bg-primary border border-nd-border text-xs font-mono text-nd-text-primary overflow-auto max-h-80 whitespace-pre-wrap leading-relaxed">
            {fullSQL}
          </pre>
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 p-1.5 rounded-md bg-nd-surface border border-nd-border hover:bg-nd-surface-hover transition-colors text-nd-text-muted hover:text-nd-text-primary"
            title="Copy SQL"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-nd-border">
          <span className="text-2xs text-nd-text-muted">
            {statements.length} statement{statements.length !== 1 ? 's' : ''}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={executing}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onExecute} disabled={executing}>
              {executing ? (
                <>
                  <RefreshCw size={13} className="animate-spin" />
                  Executing...
                </>
              ) : (
                <>
                  <Save size={13} />
                  Execute Changes
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ── Column Row ──

interface ColumnRowProps {
  col: StructureColumn
  fkColumns: string[]
  dbType: DatabaseType
  typesSuggestions: string[]
  onUpdate: (uid: string, field: keyof StructureColumn, value: unknown) => void
  onDelete: (uid: string) => void
  onUndoDelete: (uid: string) => void
  index: number
}

const ColumnRow = memo(function ColumnRow({
  col,
  fkColumns,
  dbType,
  typesSuggestions,
  onUpdate,
  onDelete,
  onUndoDelete,
  index,
}: ColumnRowProps) {
  const isModified = col._modified || col._status === 'added'
  const isDeleted = col._deleted
  const isNew = col._status === 'added'

  const tdClass = 'px-1 py-0.5 text-xs'

  return (
    <tr
      className={cn(
        'group transition-colors border-b border-nd-border/50 last:border-b-0',
        isDeleted && 'opacity-40 bg-nd-error/5',
        !isDeleted && isNew && 'bg-nd-accent/5',
        !isDeleted && !isNew && isModified && 'bg-nd-warning/5',
        !isDeleted && 'hover:bg-nd-surface-hover'
      )}
    >
      {/* Position indicator */}
      <td className={cn(tdClass, 'w-8 text-center text-nd-text-muted')}>
        <span className="text-2xs">{index + 1}</span>
      </td>

      {/* Name */}
      <td className={cn(tdClass, 'min-w-[180px] w-[20%]', isDeleted && 'line-through')}>
        <EditableCell
          value={col.name}
          onChange={(v) => onUpdate(col._uid, 'name', v)}
          placeholder="column_name"
          mono
          disabled={isDeleted}
        />
      </td>

      {/* Type */}
      <td className={cn(tdClass, 'min-w-[160px] w-[15%]', isDeleted && 'line-through')}>
        <EditableCell
          value={col.type}
          onChange={(v) => onUpdate(col._uid, 'type', v)}
          placeholder="varchar(255)"
          mono
          disabled={isDeleted}
          suggestions={typesSuggestions}
        />
      </td>

      {/* Nullable */}
      <td className={cn(tdClass, 'min-w-[90px] w-[8%] text-center')}>
        <NullableToggle
          value={col.nullable}
          onChange={(v) => onUpdate(col._uid, 'nullable', v)}
          disabled={isDeleted}
        />
      </td>

      {/* Default */}
      <td className={cn(tdClass, 'min-w-[140px] w-[14%]')}>
        <EditableCell
          value={col.defaultValue ?? ''}
          onChange={(v) => onUpdate(col._uid, 'defaultValue', v || null)}
          placeholder="NULL"
          mono
          disabled={isDeleted}
          className="text-nd-text-secondary"
        />
      </td>

      {/* Key badges */}
      <td className={cn(tdClass, 'min-w-[80px] w-[7%]')}>
        <div className="flex items-center gap-1 px-1">
          <PKToggle
            value={col.isPrimaryKey}
            onChange={(v) => onUpdate(col._uid, 'isPrimaryKey', v)}
            disabled={isDeleted}
          />
          {getColumnBadges(col, fkColumns)
            .filter((b) => b.label !== 'PK')
            .map((b) => (
              <Badge key={b.label} variant={b.variant} className="gap-0.5">
                {b.icon}
                {b.label}
              </Badge>
            ))}
        </div>
      </td>

      {/* Comment */}
      <td className={cn(tdClass, 'min-w-[140px] w-[14%]')}>
        <EditableCell
          value={col.comment}
          onChange={(v) => onUpdate(col._uid, 'comment', v)}
          placeholder="Comment..."
          disabled={isDeleted}
          className="text-nd-text-muted"
        />
      </td>

      {/* Extra (AI, charset, collation) */}
      <td className={cn(tdClass, 'min-w-[120px]')}>
        <div className="flex items-center gap-1 px-1 text-2xs text-nd-text-muted">
          {dbType === 'mysql' && col.charset && (
            <span className="font-mono">{col.charset}</span>
          )}
          {col.collation && (
            <Tooltip content={`Collation: ${col.collation}`}>
              <span className="font-mono truncate max-w-[80px]">
                {col.collation}
              </span>
            </Tooltip>
          )}
          {col.extra && !col.isAutoIncrement && (
            <span className="font-mono">{col.extra}</span>
          )}
        </div>
      </td>

      {/* Actions */}
      <td className={cn(tdClass, 'w-10 text-center')}>
        {isDeleted ? (
          <Tooltip content="Undo delete">
            <button
              className="p-1 rounded hover:bg-nd-surface-hover text-nd-text-muted hover:text-nd-accent transition-colors"
              onClick={() => onUndoDelete(col._uid)}
            >
              <Undo2 size={13} />
            </button>
          </Tooltip>
        ) : (
          <Tooltip content="Delete column">
            <button
              className="p-1 rounded hover:bg-nd-error/10 text-nd-text-muted hover:text-nd-error transition-colors opacity-0 group-hover:opacity-100"
              onClick={() => onDelete(col._uid)}
            >
              <Trash2 size={13} />
            </button>
          </Tooltip>
        )}
      </td>
    </tr>
  )
})

// ── Main component ──

export const StructureTabView = memo(function StructureTabView({
  sqlSessionId,
  table,
  schema,
  dbType,
  connectionId,
  prefetchedColumns,
  prefetchedIndexes,
  prefetchedForeignKeys,
}: StructureTabViewProps) {
  // connectionId reserved for future use (e.g. event binding)
  const [columns, setColumns] = useState<StructureColumn[]>([])
  const [indexes, setIndexes] = useState<SchemaIndex[]>([])
  const [foreignKeys, setForeignKeys] = useState<SchemaForeignKey[]>([])
  // Start as not-loading if we have pre-fetched data
  const hasPrefetch = !!(prefetchedColumns?.length || prefetchedIndexes?.length || prefetchedForeignKeys?.length)
  const [loading, setLoading] = useState(!hasPrefetch)
  const [showDDLPreview, setShowDDLPreview] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Refs for scrolling from bottom bar actions
  const contentRef = useRef<HTMLDivElement>(null)
  const indexesSectionRef = useRef<HTMLDivElement>(null)

  const typesSuggestions = useMemo(
    () => (dbType === 'mysql' ? MYSQL_TYPES : POSTGRES_TYPES),
    [dbType]
  )

  // Abort controller for cancelling in-flight server fetches (e.g. when prefetched data arrives)
  const fetchAbortRef = useRef<AbortController | null>(null)

  /** Fetch all structure data from the server (used for refresh and fallback) */
  const fetchFromServer = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      // Single query — columns + indexes + foreign keys in one roundtrip
      const res = await window.novadeck.sql.getTableStructure(sqlSessionId, table, schema)
      if (signal?.aborted) return

      if (res.success && res.data) {
        const { columns: cols, indexes: idxs, foreignKeys: fks } = res.data as {
          columns: SchemaColumn[]; indexes: any[]; foreignKeys: any[]
        }
        setColumns(cols.map((c, i) => schemaColumnToStructure(c, i)))
        setIndexes(idxs)
        setForeignKeys(fks)
      } else {
        setError(res?.error || 'Failed to load table structure')
      }
    } catch {
      if (!signal?.aborted) setError('Failed to load table structure')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [sqlSessionId, table, schema])

  // Track whether we've applied pre-fetched data for this table
  const prefetchAppliedRef = useRef<string>('')

  // Primary effect: runs on table change. Uses prefetched data if available, otherwise fetches from server
  useEffect(() => {
    const tableKey = `${sqlSessionId}:${schema || '_'}.${table}`
    prefetchAppliedRef.current = ''

    // Cancel any in-flight server fetch
    fetchAbortRef.current?.abort()

    if (prefetchedColumns?.length) {
      // Pre-fetched data is already available — use it immediately
      prefetchAppliedRef.current = tableKey
      setColumns(prefetchedColumns.map((c, i) => schemaColumnToStructure(c, i)))
      setIndexes(prefetchedIndexes ?? [])
      setForeignKeys(prefetchedForeignKeys ?? [])
      setLoading(false)
      return
    }

    // No pre-fetched data yet — start server fetch (will be cancelled if prefetch arrives)
    const controller = new AbortController()
    fetchAbortRef.current = controller
    fetchFromServer(controller.signal)

    return () => controller.abort()
  }, [sqlSessionId, table, schema]) // eslint-disable-line react-hooks/exhaustive-deps

  // Secondary effect: watches for late-arriving prefetched data.
  // If the user clicks Structure before DataTabView's IPC calls resolve,
  // the primary effect starts a server fetch. When the prefetched data arrives
  // via props, this effect cancels the server fetch and applies the data — avoiding double queries.
  useEffect(() => {
    const tableKey = `${sqlSessionId}:${schema || '_'}.${table}`

    // Only apply if: we have data, haven't applied it yet, and no user edits are pending
    if (
      prefetchAppliedRef.current === tableKey ||
      !prefetchedColumns?.length
    ) return

    prefetchAppliedRef.current = tableKey

    // Cancel any in-flight server fetch — prefetched data wins
    fetchAbortRef.current?.abort()

    setColumns(prefetchedColumns.map((c, i) => schemaColumnToStructure(c, i)))
    setIndexes(prefetchedIndexes ?? [])
    setForeignKeys(prefetchedForeignKeys ?? [])
    setLoading(false)
  }, [prefetchedColumns, prefetchedIndexes, prefetchedForeignKeys, sqlSessionId, table, schema])

  // FK column names for badge display
  const fkColumnNames = useMemo(
    () => foreignKeys.flatMap((fk) => fk.columns),
    [foreignKeys]
  )

  // ── Column operations ──

  const handleUpdateColumn = useCallback(
    (uid: string, field: keyof StructureColumn, value: unknown) => {
      setColumns((prev) =>
        prev.map((col) => {
          if (col._uid !== uid) return col
          const updated = { ...col, [field]: value }
          // Mark as modified if it's an existing column
          if (updated._status === 'existing') {
            updated._modified = isColumnModified(updated)
          }
          return updated
        })
      )
    },
    []
  )

  const handleDeleteColumn = useCallback((uid: string) => {
    setColumns((prev) =>
      prev.map((col) => {
        if (col._uid !== uid) return col
        // For new columns, just mark as deleted (we'll filter them out on save)
        // For existing columns, mark as deleted
        return { ...col, _deleted: true }
      })
    )
  }, [])

  const handleUndoDelete = useCallback((uid: string) => {
    setColumns((prev) =>
      prev.map((col) => (col._uid === uid ? { ...col, _deleted: false } : col))
    )
  }, [])

  const handleAddColumn = useCallback(() => {
    setColumns((prev) => {
      const pos = prev.length + 1
      return [...prev, createEmptyColumn(pos, dbType)]
    })
    // Scroll to bottom of columns after add
    setTimeout(() => {
      contentRef.current?.scrollTo({ top: contentRef.current.scrollHeight, behavior: 'smooth' })
    }, 50)
  }, [dbType])

  // ── Listen for add-column / add-index events from the bottom bar ──
  useEffect(() => {
    const onAddColumn = () => handleAddColumn()
    const onScrollToIndexes = () => {
      indexesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    window.addEventListener('sql:structure-add-column', onAddColumn)
    window.addEventListener('sql:structure-scroll-indexes', onScrollToIndexes)
    return () => {
      window.removeEventListener('sql:structure-add-column', onAddColumn)
      window.removeEventListener('sql:structure-scroll-indexes', onScrollToIndexes)
    }
  }, [handleAddColumn])

  const handleDiscardAll = useCallback(() => {
    fetchFromServer()
    setSuccessMsg(null)
  }, [fetchFromServer])

  // ── Change detection ──

  const hasChanges = useMemo(() => {
    return columns.some(
      (c) =>
        c._deleted ||
        c._status === 'added' ||
        (c._status === 'existing' && isColumnModified(c))
    )
  }, [columns])

  const changeCount = useMemo(() => {
    let count = 0
    for (const c of columns) {
      if (c._deleted && c._status === 'existing') count++
      if (c._status === 'added' && !c._deleted && c.name.trim()) count++
      if (c._status === 'existing' && !c._deleted && isColumnModified(c)) count++
    }
    return count
  }, [columns])

  // ── Validation ──

  const validationErrors = useMemo(() => {
    const errors: string[] = []
    const activeColumns = columns.filter((c) => !c._deleted)

    // Check for empty names on new/modified columns
    const emptyNames = activeColumns.filter(
      (c) => (c._status === 'added' || c._modified) && !c.name.trim()
    )
    if (emptyNames.length > 0) {
      errors.push(`${emptyNames.length} column(s) have empty names`)
    }

    // Check for duplicate names
    const names = activeColumns.map((c) => c.name.toLowerCase())
    const dupes = names.filter((n, i) => n && names.indexOf(n) !== i)
    if (dupes.length > 0) {
      errors.push(`Duplicate column name(s): ${[...new Set(dupes)].join(', ')}`)
    }

    return errors
  }, [columns])

  // ── DDL generation ──

  const pendingStatements = useMemo(() => {
    if (!hasChanges) return []
    return generateAlterStatements(table, schema, columns, dbType)
  }, [hasChanges, table, schema, columns, dbType])

  // ── Execute changes ──

  const handleExecute = useCallback(async () => {
    if (pendingStatements.length === 0) return
    setExecuting(true)
    setError(null)
    setSuccessMsg(null)

    try {
      const result = await window.novadeck.sql.executeStatements(
        sqlSessionId,
        pendingStatements
      )
      if (result.success) {
        setShowDDLPreview(false)
        setSuccessMsg('Structure changes applied successfully')
        // Refresh data from server
        await fetchFromServer()
        // Clear success after 4s
        setTimeout(() => setSuccessMsg(null), 4000)
      } else {
        setError(result.error || 'Failed to execute changes')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to execute changes')
    } finally {
      setExecuting(false)
    }
  }, [pendingStatements, sqlSessionId, fetchFromServer])

  // ── Table header classes ──

  const thClass =
    'px-2 py-1.5 text-left text-2xs font-semibold text-nd-text-muted uppercase tracking-wider bg-nd-surface whitespace-nowrap select-none'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-nd-border bg-nd-bg-secondary shrink-0">
        <h3 className="text-xs font-semibold text-nd-text-primary truncate">
          <Columns3 size={13} className="inline mr-1.5 -mt-0.5 text-nd-text-muted" />
          {table}
        </h3>

        <div className="flex-1" />

        {/* Change indicator */}
        {hasChanges && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="flex items-center gap-1 text-nd-warning">
              <Pencil size={11} />
              {changeCount} change{changeCount !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Action buttons */}
        {hasChanges && (
          <>
            <Button size="sm" variant="ghost" onClick={handleDiscardAll}>
              <Undo2 size={13} />
              Discard
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (validationErrors.length > 0) {
                  setError(validationErrors.join('. '))
                  return
                }
                setShowDDLPreview(true)
              }}
            >
              <Eye size={13} />
              Preview SQL
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                if (validationErrors.length > 0) {
                  setError(validationErrors.join('. '))
                  return
                }
                setShowDDLPreview(true)
              }}
            >
              <Save size={13} />
              Apply
            </Button>
          </>
        )}

        {!hasChanges && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => fetchFromServer()}
            disabled={loading}
          >
            <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
            Refresh
          </Button>
        )}
      </div>

      {/* ── Messages ── */}
      {error && (
        <div className="px-3 py-2 text-xs text-nd-error bg-nd-error/10 border-b border-nd-error/20 flex items-center gap-2">
          <AlertTriangle size={13} />
          {error}
          <button
            className="ml-auto text-nd-text-muted hover:text-nd-text-primary"
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      )}
      {successMsg && (
        <div className="px-3 py-2 text-xs text-nd-success bg-nd-success/10 border-b border-nd-success/20 flex items-center gap-2">
          <Check size={13} />
          {successMsg}
        </div>
      )}

      {/* ── Content ── */}
      <div ref={contentRef} className="flex-1 overflow-auto">
        <div className="flex flex-col gap-3 p-3">
          {/* ── Columns Section ── */}
          <Section
            title="Columns"
            icon={<Columns3 size={14} />}
            count={columns.filter((c) => !c._deleted).length}
            actions={
              <Tooltip content="Add column">
                <button
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-medium text-nd-accent bg-nd-accent/10 hover:bg-nd-accent/20 transition-colors"
                  onClick={handleAddColumn}
                >
                  <Plus size={12} />
                  Add
                </button>
              </Tooltip>
            }
          >
            {loading ? (
              <TableSkeleton rows={5} />
            ) : columns.length === 0 ? (
              <p className="px-3 py-6 text-xs text-nd-text-muted text-center">
                No columns found
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-nd-border">
                      <th className={cn(thClass, 'w-8')}>#</th>
                      <th className={cn(thClass, 'min-w-[180px] w-[20%]')}>Name</th>
                      <th className={cn(thClass, 'min-w-[160px] w-[15%]')}>Type</th>
                      <th className={cn(thClass, 'min-w-[90px] w-[8%] text-center')}>Nullable</th>
                      <th className={cn(thClass, 'min-w-[140px] w-[14%]')}>Default</th>
                      <th className={cn(thClass, 'min-w-[80px] w-[7%]')}>Key</th>
                      <th className={cn(thClass, 'min-w-[140px] w-[14%]')}>Comment</th>
                      <th className={cn(thClass, 'min-w-[120px]')}>
                        {dbType === 'mysql' ? 'Charset / Collation' : 'Collation / Extra'}
                      </th>
                      <th className={cn(thClass, 'w-10')} />
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((col, idx) => (
                      <ColumnRow
                        key={col._uid}
                        col={col}
                        fkColumns={fkColumnNames}
                        dbType={dbType}
                        typesSuggestions={typesSuggestions}
                        onUpdate={handleUpdateColumn}
                        onDelete={handleDeleteColumn}
                        onUndoDelete={handleUndoDelete}
                        index={idx}
                      />
                    ))}
                  </tbody>
                </table>


              </div>
            )}
          </Section>

          {/* ── Indexes Section ── */}
          <div ref={indexesSectionRef}>
          <Section
            title="Indexes"
            icon={<ListTree size={14} />}
            count={indexes.length}
            defaultOpen={true}
          >
            {loading ? (
              <TableSkeleton rows={3} />
            ) : indexes.length === 0 ? (
              <p className="px-3 py-4 text-xs text-nd-text-muted text-center">
                No indexes
              </p>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-nd-border">
                    <th className={thClass}>Name</th>
                    <th className={thClass}>Columns</th>
                    <th className={thClass}>Unique</th>
                    <th className={thClass}>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {indexes.map((idx) => (
                    <tr
                      key={idx.name}
                      className={cn(
                        'hover:bg-nd-surface-hover transition-colors border-b border-nd-border/50 last:border-b-0',
                        idx.isPrimary && 'bg-nd-info/5'
                      )}
                    >
                      <td className="px-2 py-1.5 text-xs font-medium text-nd-text-primary">
                        <span className="flex items-center gap-1.5">
                          {idx.isPrimary && <Key size={10} className="text-nd-info" />}
                          {idx.name}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-xs font-mono text-nd-text-secondary">
                        {idx.columns.join(', ')}
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        <Badge variant={idx.isUnique ? 'success' : 'default'}>
                          {idx.isUnique ? 'YES' : 'NO'}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-nd-text-muted uppercase">
                        {idx.type}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
          </div>

          {/* ── Foreign Keys Section ── */}
          <Section
            title="Foreign Keys"
            icon={<Link2 size={14} />}
            count={foreignKeys.length}
            defaultOpen={true}
          >
            {loading ? (
              <TableSkeleton rows={2} />
            ) : foreignKeys.length === 0 ? (
              <p className="px-3 py-4 text-xs text-nd-text-muted text-center">
                No foreign keys
              </p>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-nd-border">
                    <th className={thClass}>Name</th>
                    <th className={thClass}>Columns</th>
                    <th className={thClass}>References</th>
                    <th className={thClass}>On Update</th>
                    <th className={thClass}>On Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {foreignKeys.map((fk) => (
                    <tr
                      key={fk.name}
                      className="hover:bg-nd-surface-hover transition-colors border-b border-nd-border/50 last:border-b-0"
                    >
                      <td className="px-2 py-1.5 text-xs font-medium text-nd-text-primary">
                        {fk.name}
                      </td>
                      <td className="px-2 py-1.5 text-xs font-mono text-nd-text-secondary">
                        {fk.columns.join(', ')}
                      </td>
                      <td className="px-2 py-1.5 text-xs font-mono text-nd-text-secondary">
                        <span className="text-nd-accent">{fk.referencedTable}</span>
                        ({fk.referencedColumns.join(', ')})
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        <FKActionBadge action={fk.onUpdate} />
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        <FKActionBadge action={fk.onDelete} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>
      </div>

      {/* ── DDL Preview Modal ── */}
      <DDLPreviewModal
        open={showDDLPreview}
        onClose={() => !executing && setShowDDLPreview(false)}
        onExecute={handleExecute}
        statements={pendingStatements}
        executing={executing}
      />
    </div>
  )
})

export default StructureTabView
