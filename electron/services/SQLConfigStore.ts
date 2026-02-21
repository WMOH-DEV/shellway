import Store from 'electron-store'
import { encrypt, decrypt, generateMasterKey } from '../utils/encryption'

/**
 * Stored SQL connection configuration — persisted per SSH session.
 * Passwords are encrypted at rest using the same AES-256-GCM pattern as SessionStore.
 */
export interface StoredSQLConfig {
  /** SSH connectionId (session.id) this SQL config belongs to */
  sessionId: string
  /** Friendly connection name (e.g. "Production DB") */
  connectionName?: string
  type: 'mysql' | 'postgres'
  host: string
  port: number
  username: string
  password: string
  database: string
  useSSHTunnel: boolean
  ssl: boolean
  /** SSL mode: disabled, preferred, required, verify-full */
  sslMode?: 'disabled' | 'preferred' | 'required' | 'verify-full'
  isProduction: boolean
  /** Tag/environment: development, staging, production, testing */
  tag?: 'none' | 'development' | 'staging' | 'production' | 'testing'
  /** Last successful connection time */
  lastUsed?: number
}

interface StoreSchema {
  configs: StoredSQLConfig[]
  masterKey: string
}

/**
 * SQLConfigStore — persists SQL connection credentials per SSH session.
 * Passwords are encrypted at rest. One config per SSH session ID.
 */
export class SQLConfigStore {
  private store: Store<StoreSchema>
  private masterKey: string

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'shellway-sql-configs',
      defaults: {
        configs: [],
        masterKey: '',
      },
    })

    let key = this.store.get('masterKey')
    if (!key) {
      key = generateMasterKey()
      this.store.set('masterKey', key)
    }
    this.masterKey = key
  }

  /** Get SQL config for a given SSH session. Returns null if none saved. */
  get(sessionId: string): StoredSQLConfig | null {
    const configs = this.store.get('configs', [])
    const config = configs.find((c) => c.sessionId === sessionId)
    if (!config) return null
    return this.decryptSecrets(config)
  }

  /** Save (create or update) SQL config for a given SSH session. */
  save(config: StoredSQLConfig): void {
    const encrypted = this.encryptSecrets({ ...config, lastUsed: Date.now() })
    const configs = this.store.get('configs', [])
    const idx = configs.findIndex((c) => c.sessionId === config.sessionId)
    if (idx >= 0) {
      configs[idx] = encrypted
    } else {
      configs.push(encrypted)
    }
    this.store.set('configs', configs)
  }

  /** Delete SQL config for a given SSH session. */
  delete(sessionId: string): boolean {
    const configs = this.store.get('configs', [])
    const filtered = configs.filter((c) => c.sessionId !== sessionId)
    if (filtered.length === configs.length) return false
    this.store.set('configs', filtered)
    return true
  }

  /** Get all saved SQL configs (decrypted). */
  getAll(): StoredSQLConfig[] {
    return this.store.get('configs', []).map((c) => this.decryptSecrets(c))
  }

  // ── Encryption helpers ──

  private encryptSecrets(config: StoredSQLConfig): StoredSQLConfig {
    const copy = { ...config }
    if (copy.password) {
      copy.password = encrypt(copy.password, this.masterKey)
    }
    return copy
  }

  private decryptSecrets(config: StoredSQLConfig): StoredSQLConfig {
    const copy = { ...config }
    if (copy.password) {
      try {
        copy.password = decrypt(copy.password, this.masterKey)
      } catch {
        copy.password = ''
      }
    }
    return copy
  }
}
