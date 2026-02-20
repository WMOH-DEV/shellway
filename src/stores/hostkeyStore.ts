import { create } from 'zustand'
import type { TrustedHostKey } from '@/types/hostkey'

interface HostKeyState {
  /** All trusted host keys */
  hostKeys: TrustedHostKey[]
  /** Search / filter query */
  searchQuery: string
  /** Current sort field */
  sortField: string
  /** Sort direction */
  sortDirection: 'asc' | 'desc'

  /** Replace the full host keys list */
  setHostKeys: (keys: TrustedHostKey[]) => void
  /** Add a single trusted host key */
  addHostKey: (key: TrustedHostKey) => void
  /** Remove a host key by ID */
  removeHostKey: (id: string) => void
  /** Update the comment on a host key */
  updateComment: (id: string, comment: string) => void
  /** Set the search query */
  setSearchQuery: (query: string) => void
  /** Set the sort field (toggles direction if same field) */
  setSortField: (field: string) => void
  /** Load all host keys from the main process */
  loadFromMain: () => Promise<void>
}

export const useHostKeyStore = create<HostKeyState>((set, get) => ({
  hostKeys: [],
  searchQuery: '',
  sortField: 'host',
  sortDirection: 'asc',

  setHostKeys: (keys) => set({ hostKeys: keys }),

  addHostKey: (key) =>
    set((state) => ({
      hostKeys: [...state.hostKeys, key]
    })),

  removeHostKey: (id) =>
    set((state) => ({
      hostKeys: state.hostKeys.filter((k) => k.id !== id)
    })),

  updateComment: (id, comment) =>
    set((state) => ({
      hostKeys: state.hostKeys.map((k) =>
        k.id === id ? { ...k, comment } : k
      )
    })),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSortField: (field) =>
    set((state) => ({
      sortField: field,
      sortDirection:
        state.sortField === field
          ? state.sortDirection === 'asc'
            ? 'desc'
            : 'asc'
          : 'asc'
    })),

  loadFromMain: async () => {
    try {
      const keys = await window.novadeck.hostkey.getAll()
      set({ hostKeys: keys as TrustedHostKey[] })
    } catch {
      // Silently fail — host keys may not be available yet
      set({ hostKeys: [] })
    }
  }
}))
