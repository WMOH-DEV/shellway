import { ipcMain } from 'electron'
import { SessionStore, type StoredSession } from '../services/SessionStore'
import { getSQLConfigStore } from './sql.ipc'

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
/** Get the SessionStore singleton (for use by other services) */
export function getSessionStore(): SessionStore {
  return sessionStore
}

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
    const deleted = sessionStore.delete(id)
    if (deleted) {
      try { getSQLConfigStore().delete(id) } catch { /* config may not exist */ }
    }
    return deleted
  })

  ipcMain.handle('session:deleteMany', (_event, ids: string[]) => {
    const count = sessionStore.deleteMany(ids)
    const sqlConfigStore = getSQLConfigStore()
    for (const id of ids) {
      try { sqlConfigStore.delete(id) } catch { /* config may not exist */ }
    }
    return count
  })

  ipcMain.handle('session:touch', (_event, id: string) => {
    sessionStore.touch(id)
  })

  ipcMain.handle('session:reorder', (_event, orderedIds: string[]) => {
    if (!Array.isArray(orderedIds) || !orderedIds.every((id) => typeof id === 'string')) return
    sessionStore.reorder(orderedIds)
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
