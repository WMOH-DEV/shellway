import { create } from 'zustand'
import type { Session } from '@/types/session'

interface SessionState {
  /** All saved sessions */
  sessions: Session[]
  /** Currently selected session ID (for sidebar detail view) */
  selectedSessionId: string | null
  /** Search query for filtering sessions */
  searchQuery: string

  setSessions: (sessions: Session[]) => void
  addSession: (session: Session) => void
  updateSession: (id: string, updates: Partial<Session>) => void
  removeSession: (id: string) => void
  setSelectedSession: (id: string | null) => void
  setSearchQuery: (query: string) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  selectedSessionId: null,
  searchQuery: '',

  setSessions: (sessions) => set({ sessions }),

  addSession: (session) =>
    set((state) => ({ sessions: [...state.sessions, session] })),

  updateSession: (id, updates) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, ...updates, updatedAt: Date.now() } : s
      )
    })),

  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      selectedSessionId: state.selectedSessionId === id ? null : state.selectedSessionId
    })),

  setSelectedSession: (id) => set({ selectedSessionId: id }),
  setSearchQuery: (query) => set({ searchQuery: query })
}))
