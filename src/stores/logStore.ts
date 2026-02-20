import { create } from 'zustand'
import type { LogEntry, LogLevel, LogSource } from '@/types/log'

interface LogFilters {
  levels: Set<LogLevel>
  sources: Set<LogSource>
  searchQuery: string
}

interface LogState {
  /** Log entries keyed by sessionId */
  entries: Map<string, LogEntry[]>
  /** Active filters */
  filters: LogFilters
  /** Auto-scroll to bottom on new entries */
  autoScroll: boolean
  /** Whether the view is pinned to the bottom */
  pinnedToBottom: boolean

  /** Add a log entry for a session, capping at 5000 per session */
  addEntry: (sessionId: string, entry: LogEntry) => void
  /** Clear all entries for a session */
  clearEntries: (sessionId: string) => void
  /** Partially update filters */
  setFilters: (filters: Partial<LogFilters>) => void
  /** Toggle a specific log level in the filter */
  toggleLevel: (level: LogLevel) => void
  /** Toggle a specific log source in the filter */
  toggleSource: (source: LogSource) => void
  /** Set the search query filter */
  setSearchQuery: (query: string) => void
  /** Set auto-scroll behavior */
  setAutoScroll: (value: boolean) => void
  /** Get entries for a session filtered by current filters */
  getFilteredEntries: (sessionId: string) => LogEntry[]
}

const MAX_ENTRIES = 5000

const ALL_LEVELS: LogLevel[] = ['info', 'warning', 'error', 'success', 'debug']
const ALL_SOURCES: LogSource[] = ['ssh', 'sftp', 'terminal', 'portforward', 'system']

export const useLogStore = create<LogState>((set, get) => ({
  entries: new Map(),
  filters: {
    levels: new Set<LogLevel>(ALL_LEVELS),
    sources: new Set<LogSource>(ALL_SOURCES),
    searchQuery: ''
  },
  autoScroll: true,
  pinnedToBottom: true,

  addEntry: (sessionId, entry) =>
    set((state) => {
      const newMap = new Map(state.entries)
      const existing = newMap.get(sessionId) || []
      const updated = [...existing, entry]

      // Cap at MAX_ENTRIES (FIFO — remove oldest)
      if (updated.length > MAX_ENTRIES) {
        updated.splice(0, updated.length - MAX_ENTRIES)
      }

      newMap.set(sessionId, updated)
      return { entries: newMap }
    }),

  clearEntries: (sessionId) =>
    set((state) => {
      const newMap = new Map(state.entries)
      newMap.set(sessionId, [])
      return { entries: newMap }
    }),

  setFilters: (partial) =>
    set((state) => ({
      filters: { ...state.filters, ...partial }
    })),

  toggleLevel: (level) =>
    set((state) => {
      const newLevels = new Set(state.filters.levels)
      if (newLevels.has(level)) {
        newLevels.delete(level)
      } else {
        newLevels.add(level)
      }
      return { filters: { ...state.filters, levels: newLevels } }
    }),

  toggleSource: (source) =>
    set((state) => {
      const newSources = new Set(state.filters.sources)
      if (newSources.has(source)) {
        newSources.delete(source)
      } else {
        newSources.add(source)
      }
      return { filters: { ...state.filters, sources: newSources } }
    }),

  setSearchQuery: (query) =>
    set((state) => ({
      filters: { ...state.filters, searchQuery: query }
    })),

  setAutoScroll: (value) => set({ autoScroll: value, pinnedToBottom: value }),

  getFilteredEntries: (sessionId) => {
    const state = get()
    const entries = state.entries.get(sessionId) || []
    const { levels, sources, searchQuery } = state.filters
    const lowerQuery = searchQuery.toLowerCase()

    return entries.filter((entry) => {
      if (!levels.has(entry.level)) return false
      if (!sources.has(entry.source)) return false
      if (lowerQuery && !entry.message.toLowerCase().includes(lowerQuery)) {
        // Also search in details
        if (!entry.details || !entry.details.toLowerCase().includes(lowerQuery)) {
          return false
        }
      }
      return true
    })
  }
}))
