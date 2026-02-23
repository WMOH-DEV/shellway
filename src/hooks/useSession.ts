import { useCallback, useEffect } from 'react'
import { useSessionStore } from '@/stores/sessionStore'
import type { Session } from '@/types/session'
import { v4 as uuid } from 'uuid'

/**
 * Hook for session CRUD operations via IPC.
 */
export function useSession() {
  const { sessions, setSessions, addSession, updateSession, removeSession } = useSessionStore()

  /** Load all sessions from main process */
  const loadSessions = useCallback(async () => {
    const data = await window.novadeck.sessions.getAll()
    setSessions(data as Session[])
  }, [setSessions])

  /** Load on mount */
  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  /** Create a new session */
  const createSession = useCallback(
    async (data: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => {
      const session: Session = {
        ...data,
        id: uuid(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      await window.novadeck.sessions.create(session)
      addSession(session)
      return session
    },
    [addSession]
  )

  /** Update an existing session */
  const editSession = useCallback(
    async (id: string, updates: Partial<Session>) => {
      await window.novadeck.sessions.update(id, updates)
      updateSession(id, updates)
    },
    [updateSession]
  )

  /** Delete a session */
  const deleteSession = useCallback(
    async (id: string) => {
      await window.novadeck.sessions.delete(id)
      removeSession(id)
      // Clean up "Remember Last" view preference
      try { localStorage.removeItem(`shellway:lastView:${id}`) } catch { /* ignore */ }
    },
    [removeSession]
  )

  /** Duplicate a session */
  const duplicateSession = useCallback(
    async (id: string) => {
      const original = sessions.find((s) => s.id === id)
      if (!original) return null

      const { id: _id, createdAt: _ca, updatedAt: _ua, lastConnected: _lc, ...rest } = original
      return createSession({ ...rest, name: `${original.name} (Copy)` })
    },
    [sessions, createSession]
  )

  /** Delete multiple sessions */
  const deleteSessions = useCallback(
    async (ids: string[]) => {
      await window.novadeck.sessions.deleteMany(ids)
      ids.forEach((id) => {
        removeSession(id)
        try { localStorage.removeItem(`shellway:lastView:${id}`) } catch { /* ignore */ }
      })
    },
    [removeSession]
  )

  /** Reorder sessions — persists new sort order to backend */
  const reorderSessions = useCallback(
    async (orderedIds: string[]) => {
      await window.novadeck.sessions.reorder(orderedIds)
      // Update local store with new sortOrder
      const store = useSessionStore.getState()
      const idToOrder = new Map(orderedIds.map((id, i) => [id, i]))
      const updated = store.sessions.map((s) => {
        const order = idToOrder.get(s.id)
        return order !== undefined ? { ...s, sortOrder: order } : s
      })
      setSessions(updated)
    },
    [setSessions]
  )

  /** Mark session as recently connected */
  const touchSession = useCallback(async (id: string) => {
    await window.novadeck.sessions.touch(id)
  }, [])

  /** Export sessions to file (sanitized — passwords and keys stripped) */
  const exportSessions = useCallback(async () => {
    const data = await window.novadeck.sessions.export()

    // Sanitize sensitive fields before writing to disk
    const sanitized = (data as Session[]).map((session) => {
      // Deep-clone to avoid mutating the original
      const s = JSON.parse(JSON.stringify(session))
      if (s.auth) {
        delete s.auth.password
        delete s.auth.privateKeyData
        delete s.auth.passphrase
      }
      if (s.proxy) {
        delete s.proxy.password
      }
      return s as Session
    })

    const json = JSON.stringify(sanitized, null, 2)
    const result = await window.novadeck.dialog.saveFile({
      title: 'Export Sessions',
      defaultPath: 'shellway-sessions.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (!result.canceled && result.filePath) {
      await window.novadeck.fs.writeFile(result.filePath, json)
      return true
    }
    return false
  }, [])

  /** Import sessions from file */
  const importSessions = useCallback(async () => {
    const result = await window.novadeck.dialog.openFile({
      title: 'Import Sessions',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (!result.canceled && result.filePaths[0]) {
      const content = await window.novadeck.fs.readFile(result.filePaths[0])
      const data = JSON.parse(content)
      if (Array.isArray(data)) {
        const count = await window.novadeck.sessions.import(data)
        await loadSessions()
        return count as number
      }
    }
    return 0
  }, [loadSessions])

  /** Get groups */
  const getGroups = useCallback(async () => {
    return window.novadeck.sessions.getGroups()
  }, [])

  /** Set groups */
  const setGroups = useCallback(async (groups: string[]) => {
    return window.novadeck.sessions.setGroups(groups)
  }, [])

  return {
    sessions,
    createSession,
    editSession,
    deleteSession,
    duplicateSession,
    deleteSessions,
    reorderSessions,
    touchSession,
    exportSessions,
    importSessions,
    getGroups,
    setGroups,
    reload: loadSessions
  }
}
