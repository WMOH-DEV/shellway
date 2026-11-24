import { create } from 'zustand'
import type { FilterMatch, FilterSpec, SchemaColumn, TableFilter, TableFilterRequest } from '@/types/sql'
import { hasCriteria } from '@/utils/sqlFilterBuilder'

export interface FilterHandoff {
  filters: FilterSpec[]
  match?: FilterMatch
}

interface PendingHandoff {
  handoff: FilterHandoff
  at: number
}

export const HANDOFF_TTL_MS = 60_000

export function handoffKey(connectionId: string, database: string, table: string): string {
  return [connectionId, database, table].join('\n')
}

interface HandoffState {
  pending: Record<string, PendingHandoff>
  push(key: string, handoff: FilterHandoff, now?: number): void
  take(key: string, now?: number): FilterHandoff | null
}

export const useFilterHandoffStore = create<HandoffState>((set, get) => ({
  pending: {},
  push: (key, handoff, now = Date.now()) => set((s) => ({ pending: { ...s.pending, [key]: { handoff, at: now } } })),
  take: (key, now = Date.now()) => {
    const entry = get().pending[key]
    if (!entry) return null
    set((s) => {
      const rest = { ...s.pending }
      delete rest[key]
      return { pending: rest }
    })
    return now - entry.at <= HANDOFF_TTL_MS ? entry.handoff : null
  }
}))

export function toFilterSpec({ column, operator, value, value2 }: TableFilter): FilterSpec {
  return value2 === undefined ? { column, operator, value } : { column, operator, value, value2 }
}

export interface MergedFilters {
  filters: TableFilter[]
  focusId: string | null
  apply: boolean
}

export function mergeHandoff(current: TableFilter[], incoming: FilterSpec[], newId: () => string): MergedFilters {
  const apply = incoming.every(hasCriteria)
  const placed: string[] = []
  const filters = [...current]
  for (const spec of incoming) {
    const filter: TableFilter = { ...spec, id: newId(), enabled: true }
    const index = filters.findIndex((f) => f.column === spec.column && !placed.includes(f.id))
    if (index >= 0) filters[index] = filter
    else filters.push(filter)
    placed.push(filter.id)
  }
  if (!apply) return { filters, focusId: placed[0] ?? null, apply }
  return { filters: filters.map((f) => (placed.includes(f.id) ? f : { ...f, enabled: false })), focusId: null, apply }
}

export async function handoffFor(request: TableFilterRequest, keyColumn: () => Promise<string | null>): Promise<FilterHandoff | null> {
  if (request.kind === 'filters') return { filters: request.filters, match: request.match }
  const column = await keyColumn()
  return column ? { filters: [{ column, operator: 'equals', value: request.value }] } : null
}

export async function rowKeyColumn(sqlSessionId: string, table: string): Promise<string | null> {
  const res = await window.novadeck.sql.getTableStructure(sqlSessionId, table).catch(() => null)
  const columns: SchemaColumn[] = res?.success ? ((res.data as { columns?: SchemaColumn[] } | undefined)?.columns ?? []) : []
  const keys = columns.filter((c) => c.isPrimaryKey)
  if (keys.length === 1) return keys[0].name
  return columns.some((c) => c.name === 'id') ? 'id' : null
}
