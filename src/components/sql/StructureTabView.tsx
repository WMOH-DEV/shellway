import { memo, useState, useEffect, useCallback } from 'react'
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Columns3,
  ListTree,
  Link2,
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { SchemaColumn, SchemaIndex, SchemaForeignKey } from '@/types/sql'

// ── Props ──

interface StructureTabViewProps {
  sqlSessionId: string
  table: string
  schema?: string
}

// ── Key badge helpers ──

interface KeyBadge {
  label: string
  variant: 'info' | 'accent' | 'success' | 'warning' | 'default'
}

function getColumnBadges(col: SchemaColumn, fkColumns: string[]): KeyBadge[] {
  const badges: KeyBadge[] = []
  if (col.isPrimaryKey) badges.push({ label: 'PRI', variant: 'info' })
  if (col.isAutoIncrement) badges.push({ label: 'AI', variant: 'accent' })
  if (fkColumns.includes(col.name)) badges.push({ label: 'FK', variant: 'warning' })
  return badges
}

// ── Collapsible section ──

interface SectionProps {
  title: string
  icon: React.ReactNode
  count: number
  defaultOpen?: boolean
  children: React.ReactNode
}

const Section = memo(function Section({
  title,
  icon,
  count,
  defaultOpen = true,
  children,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  const toggle = useCallback(() => setOpen((o) => !o), [])

  return (
    <div className="border border-nd-border rounded-md overflow-hidden">
      <button
        onClick={toggle}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold text-nd-text-primary bg-nd-surface hover:bg-nd-surface-hover transition-colors"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {icon}
        <span>{title}</span>
        <Badge variant="default" className="ml-auto">
          {count}
        </Badge>
      </button>
      {open && <div className="border-t border-nd-border">{children}</div>}
    </div>
  )
})

// ── FK action badge ──

function FKActionBadge({ action }: { action: string }) {
  const upper = action.toUpperCase()
  let variant: 'error' | 'warning' | 'info' | 'default' = 'default'
  if (upper === 'CASCADE') variant = 'error'
  else if (upper === 'SET NULL') variant = 'warning'
  else if (upper === 'RESTRICT') variant = 'info'
  return <Badge variant={variant}>{upper}</Badge>
}

// ── Loading skeleton ──

function TableSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="p-3 space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-5 bg-nd-surface animate-pulse rounded" />
      ))}
    </div>
  )
}

// ── Main component ──

export const StructureTabView = memo(function StructureTabView({
  sqlSessionId,
  table,
  schema,
}: StructureTabViewProps) {
  const [columns, setColumns] = useState<SchemaColumn[]>([])
  const [indexes, setIndexes] = useState<SchemaIndex[]>([])
  const [foreignKeys, setForeignKeys] = useState<SchemaForeignKey[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      // IPC returns { success, data, error } — unwrap the envelope
      const [colsRes, idxsRes, fksRes] = await Promise.all([
        window.novadeck.sql.getColumns(sqlSessionId, table, schema),
        window.novadeck.sql.getIndexes(sqlSessionId, table, schema),
        window.novadeck.sql.getForeignKeys(sqlSessionId, table, schema),
      ])
      if (colsRes.success && colsRes.data) setColumns(colsRes.data)
      if (idxsRes.success && idxsRes.data) setIndexes(idxsRes.data)
      if (fksRes.success && fksRes.data) setForeignKeys(fksRes.data)
    } catch {
      // Errors handled upstream; keep previous state
    } finally {
      setLoading(false)
    }
  }, [sqlSessionId, table, schema])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const fkColumnNames = foreignKeys.flatMap((fk) => fk.columns)

  const thClass =
    'px-3 py-1.5 text-left text-2xs font-semibold text-nd-text-muted uppercase tracking-wide bg-nd-surface'
  const tdClass = 'px-3 py-1.5 text-xs text-nd-text-primary whitespace-nowrap'

  return (
    <div className="flex flex-col gap-3 p-3 overflow-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-nd-text-primary">
          Structure: {table}
        </h3>
        <Button size="sm" variant="ghost" onClick={fetchAll} disabled={loading}>
          <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Columns */}
      <Section
        title="Columns"
        icon={<Columns3 size={14} />}
        count={columns.length}
      >
        {loading ? (
          <TableSkeleton rows={4} />
        ) : columns.length === 0 ? (
          <p className="px-3 py-4 text-xs text-nd-text-muted text-center">
            No columns found
          </p>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr>
                <th className={thClass}>Name</th>
                <th className={thClass}>Type</th>
                <th className={thClass}>Nullable</th>
                <th className={thClass}>Default</th>
                <th className={thClass}>Key</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-nd-border">
              {columns.map((col) => (
                <tr
                  key={col.name}
                  className="hover:bg-nd-surface-hover transition-colors"
                >
                  <td className={cn(tdClass, 'font-medium')}>{col.name}</td>
                  <td className={cn(tdClass, 'text-nd-text-secondary font-mono')}>
                    {col.type}
                  </td>
                  <td className={tdClass}>
                    <Badge variant={col.nullable ? 'warning' : 'success'}>
                      {col.nullable ? 'YES' : 'NO'}
                    </Badge>
                  </td>
                  <td className={cn(tdClass, 'text-nd-text-muted')}>
                    {col.isAutoIncrement
                      ? '(auto)'
                      : col.defaultValue !== null
                        ? col.defaultValue
                        : 'NULL'}
                  </td>
                  <td className={tdClass}>
                    <div className="flex items-center gap-1">
                      {getColumnBadges(col, fkColumnNames).map((b) => (
                        <Badge key={b.label} variant={b.variant}>
                          {b.label}
                        </Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Indexes */}
      <Section
        title="Indexes"
        icon={<ListTree size={14} />}
        count={indexes.length}
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
              <tr>
                <th className={thClass}>Name</th>
                <th className={thClass}>Columns</th>
                <th className={thClass}>Unique</th>
                <th className={thClass}>Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-nd-border">
              {indexes.map((idx) => (
                <tr
                  key={idx.name}
                  className={cn(
                    'hover:bg-nd-surface-hover transition-colors',
                    idx.isPrimary && 'bg-nd-accent/5'
                  )}
                >
                  <td className={cn(tdClass, 'font-medium')}>{idx.name}</td>
                  <td className={cn(tdClass, 'font-mono text-nd-text-secondary')}>
                    {idx.columns.join(', ')}
                  </td>
                  <td className={tdClass}>
                    <Badge variant={idx.isUnique ? 'success' : 'default'}>
                      {idx.isUnique ? 'YES' : 'NO'}
                    </Badge>
                  </td>
                  <td className={cn(tdClass, 'text-nd-text-muted')}>{idx.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Foreign Keys */}
      <Section
        title="Foreign Keys"
        icon={<Link2 size={14} />}
        count={foreignKeys.length}
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
              <tr>
                <th className={thClass}>Name</th>
                <th className={thClass}>Columns</th>
                <th className={thClass}>References</th>
                <th className={thClass}>On Update</th>
                <th className={thClass}>On Delete</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-nd-border">
              {foreignKeys.map((fk) => (
                <tr
                  key={fk.name}
                  className="hover:bg-nd-surface-hover transition-colors"
                >
                  <td className={cn(tdClass, 'font-medium')}>{fk.name}</td>
                  <td className={cn(tdClass, 'font-mono text-nd-text-secondary')}>
                    {fk.columns.join(', ')}
                  </td>
                  <td className={cn(tdClass, 'font-mono text-nd-text-secondary')}>
                    {fk.referencedTable}({fk.referencedColumns.join(', ')})
                  </td>
                  <td className={tdClass}>
                    <FKActionBadge action={fk.onUpdate} />
                  </td>
                  <td className={tdClass}>
                    <FKActionBadge action={fk.onDelete} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  )
})

export default StructureTabView
