import { create } from 'zustand'
import type { FilterMatch, FilterSpec } from '@/types/sql'

export interface RecentFilter {
  scopeId: string
  database: string
  table: string
  filters: FilterSpec[]
  match: FilterMatch
  at: number
}

const STORAGE_KEY = 'shellway.search.recentFilters'
export const MAX_RECENT_FILTERS = 30

function isRecentFilter(value: unknown): value is RecentFilter {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.scopeId === 'string' &&
    typeof entry.database === 'string' &&
    typeof entry.table === 'string' &&
    typeof entry.at === 'number' &&
    (entry.match === 'all' || entry.match === 'any') &&
    Array.isArray(entry.filters)
  )
}

function readStored(): RecentFilter[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isRecentFilter) : []
  } catch {
    return []
  }
}

function writeStored(entries: RecentFilter[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {}
}

export function sameRecentFilter(a: Omit<RecentFilter, 'at'>, b: Omit<RecentFilter, 'at'>): boolean {
  return (
    a.scopeId === b.scopeId &&
    a.database === b.database &&
    a.table === b.table &&
    a.match === b.match &&
    JSON.stringify(a.filters) === JSON.stringify(b.filters)
  )
}

interface RecentFiltersState {
  entries: RecentFilter[]
}

export const useRecentFiltersStore = create<RecentFiltersState>(() => ({ entries: readStored() }))

function replaceEntries(entries: RecentFilter[]): void {
  useRecentFiltersStore.setState({ entries })
  writeStored(entries)
}

export function forgetRecentFilters(scopeId: string): void {
  replaceEntries(useRecentFiltersStore.getState().entries.filter((e) => e.scopeId !== scopeId))
}

export function clearRecentFilters(): void {
  replaceEntries([])
}

export function recordRecentFilter(entry: Omit<RecentFilter, 'at'>, now = Date.now()): void {
  if (entry.filters.length === 0) return
  const kept = useRecentFiltersStore.getState().entries.filter((e) => !sameRecentFilter(e, entry))
  replaceEntries([{ ...entry, at: now }, ...kept].slice(0, MAX_RECENT_FILTERS))
}
