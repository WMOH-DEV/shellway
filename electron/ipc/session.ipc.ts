import { ipcMain } from 'electron'
import { SessionStore, type StoredSession } from '../services/SessionStore'

const sessionStore = new SessionStore()

/**
 * Register all session-related IPC handlers.
 * Channels:
 *   session:getAll    → StoredSession[]
 *   session:getById   → StoredSession | null
 *   session:create    → StoredSession
 *   session:update    → StoredSession | null
 *   session:delete    → boolean
 *   session:deleteMany → number
 *   session:touch     → void
 *   session:getGroups → string[]
 *   session:setGroups → void
 *   session:export    → StoredSession[]
 *   session:import    → number
 */
export function registerSessionIPC(): void {
  ipcMain.handle('session:getAll', () => {
    return sessionStore.getAll()
  })

  ipcMain.handle('session:getById', (_event, id: string) => {
    return sessionStore.getById(id) ?? null
  })

  ipcMain.handle('session:create', (_event, session: StoredSession) => {
    return sessionStore.create(session)
  })

  ipcMain.handle('session:update', (_event, id: string, updates: Partial<StoredSession>) => {
    return sessionStore.update(id, updates) ?? null
  })

  ipcMain.handle('session:delete', (_event, id: string) => {
    return sessionStore.delete(id)
  })

  ipcMain.handle('session:deleteMany', (_event, ids: string[]) => {
    return sessionStore.deleteMany(ids)
  })

  ipcMain.handle('session:touch', (_event, id: string) => {
    sessionStore.touch(id)
  })

  ipcMain.handle('session:getGroups', () => {
    return sessionStore.getGroups()
  })

  ipcMain.handle('session:setGroups', (_event, groups: string[]) => {
    sessionStore.setGroups(groups)
  })

  ipcMain.handle('session:export', () => {
    return sessionStore.exportSessions()
  })

  ipcMain.handle('session:import', (_event, sessions: StoredSession[]) => {
    return sessionStore.importSessions(sessions)
  })
}
