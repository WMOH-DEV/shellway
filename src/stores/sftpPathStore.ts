import { create } from 'zustand'

/**
 * Persists the last visited local/remote paths per SESSION (not connection),
 * so SFTP panels remember their directory across tab closes and reconnects.
 * 
 * Keys are `${sessionId}:${panelType}` (e.g. "session-abc:local" or "session-abc:remote").
 * Using sessionId ensures paths survive across different connectionIds for the same server.
 */
interface SFTPPathState {
  /** Map of "sessionId:panelType" → last known path */
  paths: Record<string, string>
  /** Save the current path for a session + panel */
  setPath: (sessionId: string, panelType: 'local' | 'remote', path: string) => void
  /** Get the last known path for a session + panel (or undefined) */
  getPath: (sessionId: string, panelType: 'local' | 'remote') => string | undefined
  /** Clear paths for a session */
  clearSession: (sessionId: string) => void
}

export const useSFTPPathStore = create<SFTPPathState>((set, get) => ({
  paths: {},

  setPath: (sessionId, panelType, path) =>
    set((state) => ({
      paths: { ...state.paths, [`${sessionId}:${panelType}`]: path }
    })),

  getPath: (sessionId, panelType) =>
    get().paths[`${sessionId}:${panelType}`],

  clearSession: (sessionId) =>
    set((state) => {
      const paths = { ...state.paths }
      delete paths[`${sessionId}:local`]
      delete paths[`${sessionId}:remote`]
      return { paths }
    })
}))
