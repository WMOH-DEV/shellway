import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Persists the last visited local/remote paths per SESSION (not connection),
 * so SFTP panels remember their directory across tab closes, reconnects,
 * and app restarts.
 * 
 * Keys are `${sessionId}:${panelType}` (e.g. "session-abc:local" or "session-abc:remote").
 * Using sessionId ensures paths survive across different connectionIds for the same server.
 * 
 * Also tracks path history for autocomplete suggestions and the "Recent Paths" dropdown.
 * History is ordered by recency — most recently visited paths are at the end.
 */
interface SFTPPathState {
  /** Map of "sessionId:panelType" → last known path */
  paths: Record<string, string>
  /** Map of "sessionId:panelType" → recently visited paths (ordered by recency, newest last) */
  pathHistory: Record<string, string[]>
  /** Save the current path for a session + panel */
  setPath: (sessionId: string, panelType: 'local' | 'remote', path: string) => void
  /** Get the last known path for a session + panel (or undefined) */
  getPath: (sessionId: string, panelType: 'local' | 'remote') => string | undefined
  /** Get all visited paths for a session + panel (ordered by recency, newest last) */
  getPathHistory: (sessionId: string, panelType: 'local' | 'remote') => string[]
  /** Get the N most recently visited paths (newest first) for the Recent Paths dropdown */
  getRecentPaths: (sessionId: string, panelType: 'local' | 'remote', count?: number) => string[]
  /** Clear paths for a session */
  clearSession: (sessionId: string) => void
}

const MAX_HISTORY_PER_PANEL = 500

export const useSFTPPathStore = create<SFTPPathState>()(
  persist(
    (set, get) => ({
      paths: {},
      pathHistory: {},

      setPath: (sessionId, panelType, path) =>
        set((state) => {
          const key = `${sessionId}:${panelType}`
          const existing = state.pathHistory[key] || []
          // Move to end if already in history (recency tracking), or append
          const withoutCurrent = existing.filter((p) => p !== path)
          const updated = [...withoutCurrent, path].slice(-MAX_HISTORY_PER_PANEL)

          return {
            paths: { ...state.paths, [key]: path },
            pathHistory: { ...state.pathHistory, [key]: updated }
          }
        }),

      getPath: (sessionId, panelType) =>
        get().paths[`${sessionId}:${panelType}`],

      getPathHistory: (sessionId, panelType) =>
        get().pathHistory[`${sessionId}:${panelType}`] || [],

      getRecentPaths: (sessionId, panelType, count = 20) => {
        const history = get().pathHistory[`${sessionId}:${panelType}`] || []
        // Return the most recent N paths in reverse order (newest first)
        return history.slice(-count).reverse()
      },

      clearSession: (sessionId) =>
        set((state) => {
          const paths = { ...state.paths }
          const pathHistory = { ...state.pathHistory }
          delete paths[`${sessionId}:local`]
          delete paths[`${sessionId}:remote`]
          delete pathHistory[`${sessionId}:local`]
          delete pathHistory[`${sessionId}:remote`]
          return { paths, pathHistory }
        })
    }),
    {
      name: 'shellway-sftp-paths',
      partialize: (state) => ({
        paths: state.paths,
        pathHistory: state.pathHistory,
      }),
    }
  )
)
