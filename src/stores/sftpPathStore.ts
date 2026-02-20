import { create } from 'zustand'

/**
 * Persists the last visited local/remote paths per SESSION (not connection),
 * so SFTP panels remember their directory across tab closes and reconnects.
 * 
 * Keys are `${sessionId}:${panelType}` (e.g. "session-abc:local" or "session-abc:remote").
 * Using sessionId ensures paths survive across different connectionIds for the same server.
 * 
 * Also tracks path history for autocomplete suggestions.
 */
interface SFTPPathState {
  /** Map of "sessionId:panelType" → last known path */
  paths: Record<string, string>
  /** Map of "sessionId:panelType" → set of all visited paths (for autocomplete) */
  pathHistory: Record<string, string[]>
  /** Save the current path for a session + panel */
  setPath: (sessionId: string, panelType: 'local' | 'remote', path: string) => void
  /** Get the last known path for a session + panel (or undefined) */
  getPath: (sessionId: string, panelType: 'local' | 'remote') => string | undefined
  /** Get all visited paths for a session + panel */
  getPathHistory: (sessionId: string, panelType: 'local' | 'remote') => string[]
  /** Clear paths for a session */
  clearSession: (sessionId: string) => void
}

const MAX_HISTORY_PER_PANEL = 500

export const useSFTPPathStore = create<SFTPPathState>((set, get) => ({
  paths: {},
  pathHistory: {},

  setPath: (sessionId, panelType, path) =>
    set((state) => {
      const key = `${sessionId}:${panelType}`
      const existing = state.pathHistory[key] || []
      // Only add if not already in history
      const updated = existing.includes(path)
        ? existing
        : [...existing, path].slice(-MAX_HISTORY_PER_PANEL)

      return {
        paths: { ...state.paths, [key]: path },
        pathHistory: { ...state.pathHistory, [key]: updated }
      }
    }),

  getPath: (sessionId, panelType) =>
    get().paths[`${sessionId}:${panelType}`],

  getPathHistory: (sessionId, panelType) =>
    get().pathHistory[`${sessionId}:${panelType}`] || [],

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
}))
