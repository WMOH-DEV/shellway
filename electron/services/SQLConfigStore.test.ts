import { describe, expect, it, vi } from 'vitest'
import { SQLConfigStore, type StoredSQLConfig } from './SQLConfigStore'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/shellway-test' } }))

vi.mock('electron-store', () => ({
  default: class {
    private data: Record<string, unknown>
    constructor({ defaults }: { defaults: Record<string, unknown> }) {
      this.data = structuredClone(defaults)
    }
    get(key: string, fallback?: unknown): unknown {
      return this.data[key] ?? fallback
    }
    set(key: string, value: unknown): void {
      this.data[key] = value
    }
  }
}))

const config = (overrides: Partial<StoredSQLConfig>): StoredSQLConfig => ({
  sessionId: 'db-1',
  connectionName: 'Billing',
  type: 'mysql',
  host: 'db.example.com',
  port: 3306,
  username: 'app',
  password: 'db-secret',
  database: 'billing',
  useSSHTunnel: true,
  ssl: false,
  isProduction: true,
  tag: 'production',
  sshHost: 'jump.example.com',
  sshUsername: 'deploy',
  sshAuthMethod: 'password',
  sshPassword: 'ssh-secret',
  sshPassphrase: 'key-secret',
  ...overrides
})

describe('SQLConfigStore.listStandalone', () => {
  it('lists standalone connections without any credentials', () => {
    const store = new SQLConfigStore()
    store.save(config({}))
    store.save(config({ sessionId: 'ssh-session-1', connectionName: 'Server database' }))

    const listed = store.listStandalone()

    expect(listed).toEqual([
      { sessionId: 'db-1', connectionName: 'Billing', type: 'mysql', host: 'db.example.com', port: 3306, database: 'billing', tag: 'production', lastUsed: expect.any(Number) }
    ])
    expect(JSON.stringify(listed)).not.toMatch(/secret|deploy|jump|app/)
    expect(store.get('db-1')?.password).toBe('db-secret')
  })

  it('marks a connection as used without touching its secrets', () => {
    vi.useFakeTimers({ now: 1_000 })
    const store = new SQLConfigStore()
    store.save(config({}))
    vi.setSystemTime(9_000)

    store.markUsed('db-1')
    store.markUsed('db-missing')

    expect(store.listStandalone()[0].lastUsed).toBe(9_000)
    expect(store.get('db-1')?.password).toBe('db-secret')
    vi.useRealTimers()
  })
})
