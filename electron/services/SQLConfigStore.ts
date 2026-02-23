import Store from 'electron-store'
import { app } from 'electron'
import { createHash } from 'crypto'
import { hostname } from 'os'
import { encrypt, decrypt, generateMasterKey } from '../utils/encryption'

/**
 * Stored SQL connection configuration — persisted per session (SSH or standalone DB).
 * Passwords and SSH credentials are encrypted at rest using AES-256-GCM.
 */
export interface StoredSQLConfig {
  /** Session key — SSH session.id for SSH tabs, or `db-{uuid}` for standalone DB tabs */
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

  // ── SSH tunnel configuration (for standalone DB connections) ──
  /** SSH server host for tunnel */
  sshHost?: string
  /** SSH server port (default 22) */
  sshPort?: number
  /** SSH username */
  sshUsername?: string
  /** SSH auth method: password or privatekey */
  sshAuthMethod?: 'password' | 'privatekey'
  /** SSH password (encrypted at rest) */
  sshPassword?: string
  /** Path to SSH private key file */
  sshPrivateKeyPath?: string
  /** SSH private key passphrase (encrypted at rest) */
  sshPassphrase?: string
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

    // Derive a machine-bound key instead of using OS Keychain (safeStorage).
    // This avoids the macOS "app wants to access confidential Chromium data" prompt
    // while still encrypting secrets at rest. The key is deterministic per machine —
    // copying the JSON file to another machine won't expose passwords.
    const machineKey = this.deriveMachineKey()

    const storedKey = this.store.get('masterKey')
    if (storedKey) {
      try {
        // The stored master key is encrypted with the machine-derived key.
        this.masterKey = decrypt(storedKey, machineKey)
      } catch {
        // Decryption failed (machine changed, or migrating from safeStorage).
        // Generate a fresh master key — old encrypted passwords will fallback to ''.
        const newKey = generateMasterKey()
        this.masterKey = newKey
        this.store.set('masterKey', encrypt(newKey, machineKey))
      }
    } else {
      // First launch — generate and persist an encrypted master key.
      const newKey = generateMasterKey()
      this.masterKey = newKey
      this.store.set('masterKey', encrypt(newKey, machineKey))
    }
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

  /** Get all standalone database configs (sessionId starts with "db-"). */
  getStandalone(): StoredSQLConfig[] {
    return this.store
      .get('configs', [])
      .filter((c) => c.sessionId.startsWith('db-'))
      .map((c) => this.decryptSecrets(c))
  }

  // ── Key derivation ──

  /**
   * Derive a deterministic encryption key from machine-specific data.
   * Combines hostname + Electron userData path + a hardcoded app salt.
   * This ties the encryption to this specific machine without touching the OS Keychain.
   */
  private deriveMachineKey(): string {
    const material = [
      hostname(),
      app.getPath('userData'),
      'shellway-v1-machine-bound-salt-9f3a7c',
    ].join('::')
    return createHash('sha256').update(material).digest('hex')
  }

  // ── Encryption helpers ──

  private encryptSecrets(config: StoredSQLConfig): StoredSQLConfig {
    const copy = { ...config }
    if (copy.password) {
      copy.password = encrypt(copy.password, this.masterKey)
    }
    if (copy.sshPassword) {
      copy.sshPassword = encrypt(copy.sshPassword, this.masterKey)
    }
    if (copy.sshPassphrase) {
      copy.sshPassphrase = encrypt(copy.sshPassphrase, this.masterKey)
    }
    return copy
  }

  private decryptSecrets(config: StoredSQLConfig): StoredSQLConfig {
    const copy = { ...config }
    if (copy.password) {
      try { copy.password = decrypt(copy.password, this.masterKey) }
      catch { copy.password = '' }
    }
    if (copy.sshPassword) {
      try { copy.sshPassword = decrypt(copy.sshPassword, this.masterKey) }
      catch { copy.sshPassword = '' }
    }
    if (copy.sshPassphrase) {
      try { copy.sshPassphrase = decrypt(copy.sshPassphrase, this.masterKey) }
      catch { copy.sshPassphrase = '' }
    }
    return copy
  }
}
