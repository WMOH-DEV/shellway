import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNovadeck } from '@/test/novadeck'

const CACHE_KEY = 'sql-saved-dbs'

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value)
  }
}

let localStorage: ReturnType<typeof memoryStorage>

const withSecrets = {
  sessionId: 'db-1',
  connectionName: 'Billing',
  type: 'mysql',
  host: 'db.example.com',
  port: 3306,
  database: 'billing',
  username: 'app',
  password: 'cached-db-password',
  sshPassword: 'cached-ssh-password',
  sshPassphrase: 'cached-passphrase'
}

const publicOnly = { sessionId: 'db-1', connectionName: 'Billing', type: 'mysql', host: 'db.example.com', port: 3306, database: 'billing' }

async function loadStore() {
  vi.resetModules()
  return import('./savedDatabaseStore')
}

describe('saved database store', () => {
  beforeEach(() => {
    localStorage = memoryStorage()
    vi.stubGlobal('localStorage', localStorage)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('rewrites an old cache that still holds passwords', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify([withSecrets]))
    const { useSavedDatabaseStore } = await loadStore()

    expect(useSavedDatabaseStore.getState().databases).toEqual([publicOnly])
    expect(localStorage.getItem(CACHE_KEY)).not.toContain('cached-')
  })

  it('never keeps secrets from a refresh', async () => {
    mockNovadeck({ 'sql.configGetStandalone': vi.fn().mockResolvedValue({ success: true, data: [withSecrets] }) })
    const { useSavedDatabaseStore } = await loadStore()

    await useSavedDatabaseStore.getState().load()

    expect(useSavedDatabaseStore.getState().databases).toEqual([publicOnly])
    expect(localStorage.getItem(CACHE_KEY)).not.toContain('cached-')
  })

  it('keeps the list when a refresh fails and forgets a deleted connection', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify([publicOnly, { ...publicOnly, sessionId: 'db-2' }]))
    mockNovadeck({ 'sql.configGetStandalone': vi.fn().mockRejectedValue(new Error('offline')) })
    const { useSavedDatabaseStore } = await loadStore()

    await useSavedDatabaseStore.getState().load()
    expect(useSavedDatabaseStore.getState().databases).toHaveLength(2)

    useSavedDatabaseStore.getState().forget('db-2')
    expect(useSavedDatabaseStore.getState().databases).toEqual([publicOnly])
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!)).toEqual([publicOnly])
  })
})
