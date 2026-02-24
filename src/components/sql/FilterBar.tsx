import React, { useCallback, useMemo, useState, useEffect } from 'react'
import { Plus, Minus, Filter, AlertTriangle } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import type { TableFilter, FilterOperator, QueryField } from '@/types/sql'

// ── Operator definitions by column-type category ──

type ColumnCategory = 'string' | 'number' | 'date' | 'boolean' | 'raw_sql'

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  equals: '=',
  not_equals: '!=',
  contains: 'Contains',
  not_contains: 'Not Contains',
  starts_with: 'Starts With',
  ends_with: 'Ends With',
  greater_than: '>',
  less_than: '<',
  greater_or_equal: '>=',
  less_or_equal: '<=',
  is_null: 'IS NULL',
  is_not_null: 'IS NOT NULL',
  in: 'IN',
  not_in: 'NOT IN',
  between: 'BETWEEN',
  raw_sql: 'Raw SQL',
}

const OPERATORS_BY_CATEGORY: Record<ColumnCategory, FilterOperator[]> = {
  string: [
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'starts_with',
    'ends_with',
    'is_null',
    'is_not_null',
  ],
  number: [
    'equals',
    'not_equals',
    'greater_than',
    'less_than',
    'greater_or_equal',
    'less_or_equal',
    'between',
    'in',
    'is_null',
    'is_not_null',
  ],
  date: [
    'equals',
    'greater_than',
    'less_than',
    'between',
    'is_null',
    'is_not_null',
  ],
  boolean: ['equals', 'is_null', 'is_not_null'],
  raw_sql: ['raw_sql'],
}

const STRING_TYPES = new Set([
  'varchar', 'text', 'char', 'character varying', 'character',
  'nvarchar', 'ntext', 'nchar', 'longtext', 'mediumtext', 'tinytext',
  'enum', 'set', 'uuid', 'json', 'jsonb',
])

const NUMBER_TYPES = new Set([
  'int', 'integer', 'bigint', 'smallint', 'tinyint', 'decimal',
  'numeric', 'float', 'double', 'real', 'double precision',
  'serial', 'bigserial', 'smallserial',
])

const DATE_TYPES = new Set([
  'date', 'datetime', 'timestamp', 'timestamp without time zone',
  'timestamp with time zone', 'timestamptz', 'time',
  'time without time zone', 'time with time zone', 'year',
])

const BOOLEAN_TYPES = new Set(['boolean', 'bool', 'tinyint(1)', 'bit', 'bit(1)'])

function categorizeColumn(type: string): ColumnCategory {
  const lower = type.toLowerCase()
  if (BOOLEAN_TYPES.has(lower)) return 'boolean'
  if (DATE_TYPES.has(lower)) return 'date'
  if (NUMBER_TYPES.has(lower)) return 'number'
  if (STRING_TYPES.has(lower)) return 'string'
  const base = lower.replace(/\(.*\)/, '').trim()
  if (BOOLEAN_TYPES.has(base)) return 'boolean'
  if (NUMBER_TYPES.has(base)) return 'number'
  if (DATE_TYPES.has(base)) return 'date'
  if (STRING_TYPES.has(base)) return 'string'
  return 'string'
}

// ── Props ──

interface FilterBarProps {
  filters: TableFilter[]
  columns: QueryField[]
  onFiltersChange: (filters: TableFilter[]) => void
  onApply: () => void
}

const NO_VALUE_OPERATORS = new Set<FilterOperator>(['is_null', 'is_not_null'])

// ── Individual filter row (TablePlus style) ──
// Layout: [Column] [Operator] [Value ── fills remaining ──] [Apply] [+] [-]

interface FilterRowProps {
  filter: TableFilter
  columns: QueryField[]
  onUpdate: (id: string, changes: Partial<TableFilter>) => void
  onRemove: (id: string) => void
  onAdd: () => void
  onApply: () => void
  /** When true, auto-focus the value input on mount */
  autoFocusValue?: boolean
}

const FilterRow = React.memo(function FilterRow({
  filter,
  columns,
  onUpdate,
  onRemove,
  onAdd,
  onApply,
  autoFocusValue,
}: FilterRowProps) {
  const isRawSql = filter.column === '__raw_sql__'
  const category = isRawSql
    ? 'raw_sql' as ColumnCategory
    : categorizeColumn(
        columns.find((c) => c.name === filter.column)?.type ?? 'varchar'
      )
  const operators = OPERATORS_BY_CATEGORY[category]
  const needsValue = !NO_VALUE_OPERATORS.has(filter.operator)
  const isBetween = filter.operator === 'between'

  const columnOptions = useMemo(
    () => [
      { value: '__raw_sql__', label: 'Raw SQL' },
      ...columns.map((c) => ({ value: c.name, label: c.name })),
    ],
    [columns]
  )

  const operatorOptions = useMemo(
    () =>
      operators.map((op) => ({
        value: op,
        label: OPERATOR_LABELS[op],
      })),
    [operators]
  )

  return (
    <div className={cn('flex w-full items-center gap-1.5 py-0.5', !filter.enabled && 'opacity-50')}>
      {/* Enable/disable checkbox */}
      <input
        type="checkbox"
        checked={filter.enabled}
        onChange={(e) => onUpdate(filter.id, { enabled: e.target.checked })}
        className="accent-nd-accent w-3 h-3 shrink-0 cursor-pointer"
        title={filter.enabled ? 'Disable filter' : 'Enable filter'}
      />

      {/* Column selector */}
      <Select
        options={columnOptions}
        value={filter.column}
        onChange={(e) => {
          const newCol = e.target.value
          const newIsRaw = newCol === '__raw_sql__'
          onUpdate(filter.id, {
            column: newCol,
            operator: newIsRaw ? 'raw_sql' : operators[0],
            value: '',
            value2: undefined,
          })
        }}
        className="h-6 !w-36 shrink-0 text-xs"
      />

      {/* Operator selector */}
      {!isRawSql && (
        <Select
          options={operatorOptions}
          value={filter.operator}
          onChange={(e) =>
            onUpdate(filter.id, { operator: e.target.value as FilterOperator })
          }
          className="h-6 !w-28 shrink-0 text-xs"
        />
      )}

      {/* Raw SQL warning */}
      {isRawSql && (
        <span title="Raw SQL — not parameterized" className="shrink-0">
          <AlertTriangle size={14} className="text-nd-warning" />
        </span>
      )}

      {/* Value input — fills all remaining space */}
      {needsValue && !isBetween && (
        <div className="flex-1 min-w-[60px]">
          <Input
            value={filter.value}
            onChange={(e) => onUpdate(filter.id, { value: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') onApply() }}
            placeholder={isRawSql ? 'e.g. id > 100 AND status = 1' : 'Value...'}
            className="h-6 w-full text-xs"
            autoFocus={autoFocusValue}
          />
        </div>
      )}

      {/* BETWEEN: two value inputs */}
      {needsValue && isBetween && (
        <>
          <div className="flex-1 min-w-[60px]">
            <Input
              value={filter.value}
              onChange={(e) => onUpdate(filter.id, { value: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') onApply() }}
              placeholder="From..."
              className="h-6 w-full text-xs"
            />
          </div>
          <span className="text-2xs text-nd-text-muted shrink-0">and</span>
          <div className="flex-1 min-w-[60px]">
            <Input
              value={filter.value2 ?? ''}
              onChange={(e) => onUpdate(filter.id, { value2: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') onApply() }}
              placeholder="To..."
              className="h-6 w-full text-xs"
            />
          </div>
        </>
      )}

      {/* No-value operators get a spacer so buttons stay right-aligned */}
      {!needsValue && <div className="flex-1" />}

      {/* Apply this filter */}
      <Button
        variant="ghost"
        size="sm"
        className="h-5 shrink-0 px-2 text-xs text-nd-accent hover:text-nd-accent-hover"
        onClick={onApply}
      >
        Apply
      </Button>

      {/* Add another filter */}
      <button
        onClick={onAdd}
        className="shrink-0 flex items-center justify-center h-5 w-5 rounded text-nd-text-muted hover:text-nd-success hover:bg-nd-surface transition-colors"
        title="Add filter"
      >
        <Plus size={12} />
      </button>

      {/* Remove this filter */}
      <button
        onClick={() => onRemove(filter.id)}
        className="shrink-0 flex items-center justify-center h-5 w-5 rounded text-nd-text-muted hover:text-nd-error hover:bg-nd-surface transition-colors"
        title="Remove filter"
      >
        <Minus size={12} />
      </button>
    </div>
  )
})

// ── Main FilterBar ──

function nextFilterId() {
  return crypto.randomUUID()
}

function createEmptyFilter(columns: QueryField[]): TableFilter {
  return {
    id: nextFilterId(),
    enabled: true,
    column: columns[0]?.name ?? '__raw_sql__',
    operator: 'equals',
    value: '',
  }
}

export const FilterBar = React.memo(function FilterBar({
  filters,
  columns,
  onFiltersChange,
  onApply,
}: FilterBarProps) {
  const activeCount = filters.filter((f) => f.enabled).length

  // Track last-added filter to auto-focus its value input
  const [autoFocusFilterId, setAutoFocusFilterId] = useState<string | null>(null)

  // Clear auto-focus flag after it's been consumed
  useEffect(() => {
    if (autoFocusFilterId) {
      const timer = setTimeout(() => setAutoFocusFilterId(null), 200)
      return () => clearTimeout(timer)
    }
  }, [autoFocusFilterId])

  const handleAdd = useCallback(() => {
    const newFilter = createEmptyFilter(columns)
    setAutoFocusFilterId(newFilter.id)
    onFiltersChange([...filters, newFilter])
  }, [filters, columns, onFiltersChange])

  const handleUpdate = useCallback(
    (id: string, changes: Partial<TableFilter>) => {
      onFiltersChange(
        filters.map((f) => (f.id === id ? { ...f, ...changes } : f))
      )
    },
    [filters, onFiltersChange]
  )

  const handleRemove = useCallback(
    (id: string) => {
      const updated = filters.filter((f) => f.id !== id)
      onFiltersChange(updated)
      // Re-apply only when all filters are cleared to restore unfiltered view
      if (updated.length === 0) onApply()
    },
    [filters, onFiltersChange, onApply]
  )

  const handleClear = useCallback(() => {
    onFiltersChange([])
    onApply()
  }, [onFiltersChange, onApply])

  // Show nothing if no filters — just the Add Filter button in a minimal bar
  return (
    <div className="border-b border-nd-border bg-nd-bg-secondary">
      {/* Filter rows */}
      {filters.length > 0 && (
        <div className="flex flex-col gap-0 px-2 py-1">
          {filters.map((filter) => (
            <FilterRow
              key={filter.id}
              filter={filter}
              columns={columns}
              onUpdate={handleUpdate}
              onRemove={handleRemove}
              onAdd={handleAdd}
              onApply={onApply}
              autoFocusValue={filter.id === autoFocusFilterId}
            />
          ))}
        </div>
      )}

      {/* Bottom bar */}
      <div className="flex items-center gap-2 px-2 py-1">
        {/* Left: Add Filter button + active count */}
        <Button
          variant="ghost"
          size="sm"
          className="h-5 gap-1 text-xs"
          onClick={handleAdd}
        >
          <Filter size={11} />
          Add Filter
        </Button>

        {activeCount > 0 && (
          <span className="text-2xs text-nd-accent tabular-nums">
            {activeCount} active
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: Clear + Apply All */}
        {filters.length > 0 && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-xs text-nd-text-muted"
              onClick={handleClear}
            >
              Clear
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="h-5 text-xs"
              onClick={onApply}
            >
              Apply All
            </Button>
          </>
        )}
      </div>
    </div>
  )
})
