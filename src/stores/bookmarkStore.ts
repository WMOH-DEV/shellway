import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PanelType } from '@/types/sftp'

export interface Bookmark {
  id: string
  sessionId: string
  path: string
  name: string
  panelType: PanelType
}

interface BookmarkState {
  /** All bookmarks keyed by sessionId */
  bookmarksBySession: Record<string, Bookmark[]>
  /** Add a bookmark for a session */
  addBookmark: (sessionId: string, path: string, name: string, panelType: PanelType) => void
  /** Remove a bookmark by id within a session */
  removeBookmark: (sessionId: string, id: string) => void
  /** Get all bookmarks for a session */
  getBookmarks: (sessionId: string) => Bookmark[]
}

export const useBookmarkStore = create<BookmarkState>()(
  persist(
    (set, get) => ({
      bookmarksBySession: {},

      addBookmark: (sessionId, path, name, panelType) =>
        set((state) => {
          const existing = state.bookmarksBySession[sessionId] || []
          // Prevent duplicates
          if (existing.some((b) => b.path === path && b.panelType === panelType)) {
            return state
          }
          const bookmark: Bookmark = {
            id: `bm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            sessionId,
            path,
            name,
            panelType
          }
          return {
            bookmarksBySession: {
              ...state.bookmarksBySession,
              [sessionId]: [...existing, bookmark]
            }
          }
        }),

      removeBookmark: (sessionId, id) =>
        set((state) => {
          const existing = state.bookmarksBySession[sessionId] || []
          return {
            bookmarksBySession: {
              ...state.bookmarksBySession,
              [sessionId]: existing.filter((b) => b.id !== id)
            }
          }
        }),

      getBookmarks: (sessionId) => get().bookmarksBySession[sessionId] || []
    }),
    {
      name: 'shellway-bookmarks'
    }
  )
)
