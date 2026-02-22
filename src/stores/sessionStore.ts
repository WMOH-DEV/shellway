import { create } from 'zustand'
import type { Session } from '@/types/session'

interface SessionState {
  /** All saved sessions */
  sessions: Session[]
  /** Search query for filtering sessions */
  searchQuery: string

  setSessions: (sessions: Session[]) => void
  addSession: (session: Session) => void
  updateSession: (id: string, updates: Partial<Session>) => void
  removeSession: (id: string) => void
  setSearchQuery: (query: string) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
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
      sessions: state.sessions.filter((s) => s.id !== id)
    })),

  setSearchQuery: (query) => set({ searchQuery: query })
}))
