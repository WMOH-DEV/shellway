import { create } from 'zustand'
import type { SavedDatabase } from '@/types/sql'

const CACHE_KEY = 'sql-saved-dbs'

function publicFields({ sessionId, connectionName, type, host, port, database, tag, lastUsed }: SavedDatabase): SavedDatabase {
  return { sessionId, connectionName, type, host, port, database, tag, lastUsed }
}

function writeCache(databases: SavedDatabase[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(databases))
  } catch {}
}

function readCache(): SavedDatabase[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return []
    const databases = (parsed as SavedDatabase[]).map(publicFields)
    writeCache(databases)
    return databases
  } catch {
    return []
  }
}

export function savedDatabaseLabel(db: SavedDatabase): string {
  return db.connectionName || `${db.type.toUpperCase()} · ${db.database || db.host}`
}

interface SavedDatabaseState {
  databases: SavedDatabase[]
  load(): Promise<void>
  forget(sessionId: string): void
}

export const useSavedDatabaseStore = create<SavedDatabaseState>((set, get) => ({
  databases: readCache(),
  load: async () => {
    try {
      const result = await window.novadeck.sql.configGetStandalone()
      if (!result?.success || !Array.isArray(result.data)) return
      const databases = result.data.map(publicFields)
      set({ databases })
      writeCache(databases)
    } catch {}
  },
  forget: (sessionId) => {
    const databases = get().databases.filter((db) => db.sessionId !== sessionId)
    set({ databases })
    writeCache(databases)
  }
}))
