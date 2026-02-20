import Store from 'electron-store'
import { encrypt, decrypt, generateMasterKey } from '../utils/encryption'
import type {
  SessionAuth,
  ProxyConfig,
  SessionOverrides,
  StartupCommand,
  PortForwardRule,
  SessionViewPreferences
} from '../../src/types/session'

/** Session data as stored in the electron-store — matches the expanded Session interface */
export interface StoredSession {
  id: string
  name: string
  group?: string
  host: string
  port: number
  username: string

  // Authentication (expanded)
  auth: SessionAuth

  // Proxy
  proxy: ProxyConfig

  // Per-session setting overrides
  overrides: SessionOverrides

  // Port forwarding
  portForwardings?: PortForwardRule[]

  // Startup
  defaultDirectory?: string
  startupCommands?: StartupCommand[]

  // Environment variables
  environmentVariables?: Record<string, string>

  // Shell / PTY
  shellCommand?: string
  terminalType?: string
  encoding?: string

  // View preferences
  viewPreferences?: SessionViewPreferences

  // Visual
  color?: string
  icon?: string
  notes?: string

  // Metadata
  lastConnected?: number
  createdAt: number
  updatedAt: number
  isModified?: boolean
}

interface StoreSchema {
  sessions: StoredSession[]
  masterKey: string
  groups: string[]
}

/**
 * SessionStore — manages encrypted persistence of SSH sessions.
 * Passwords, passphrases, proxy passwords, and KBDI saved responses are encrypted at rest using AES-256-GCM.
 */
export class SessionStore {
  private store: Store<StoreSchema>
  private masterKey: string

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'shellway-sessions',
      defaults: {
        sessions: [],
        masterKey: '',
        groups: []
      }
    })

    // Ensure master key exists
    let key = this.store.get('masterKey')
    if (!key) {
      key = generateMasterKey()
      this.store.set('masterKey', key)
    }
    this.masterKey = key
  }

  /** Get all sessions (with secrets decrypted for in-memory use) */
  getAll(): StoredSession[] {
    const sessions = this.store.get('sessions', [])
    return sessions.map((s) => this.decryptSecrets(s))
  }

  /** Get a single session by ID */
  getById(id: string): StoredSession | undefined {
    const sessions = this.store.get('sessions', [])
    const session = sessions.find((s) => s.id === id)
    return session ? this.decryptSecrets(session) : undefined
  }

  /** Create a new session */
  create(session: StoredSession): StoredSession {
    const encrypted = this.encryptSecrets(session)
    const sessions = this.store.get('sessions', [])
    sessions.push(encrypted)
    this.store.set('sessions', sessions)
    return session
  }

  /** Update an existing session */
  update(id: string, updates: Partial<StoredSession>): StoredSession | undefined {
    const sessions = this.store.get('sessions', [])
    const idx = sessions.findIndex((s) => s.id === id)
    if (idx === -1) return undefined

    const current = this.decryptSecrets(sessions[idx])
    const updated = { ...current, ...updates, updatedAt: Date.now() }
    sessions[idx] = this.encryptSecrets(updated)
    this.store.set('sessions', sessions)
    return updated
  }

  /** Delete a session by ID */
  delete(id: string): boolean {
    const sessions = this.store.get('sessions', [])
    const filtered = sessions.filter((s) => s.id !== id)
    if (filtered.length === sessions.length) return false
    this.store.set('sessions', filtered)
    return true
  }

  /** Delete multiple sessions */
  deleteMany(ids: string[]): number {
    const sessions = this.store.get('sessions', [])
    const idSet = new Set(ids)
    const filtered = sessions.filter((s) => !idSet.has(s.id))
    const deleted = sessions.length - filtered.length
    this.store.set('sessions', filtered)
    return deleted
  }

  /** Update last connected timestamp */
  touch(id: string): void {
    const sessions = this.store.get('sessions', [])
    const idx = sessions.findIndex((s) => s.id === id)
    if (idx !== -1) {
      sessions[idx].lastConnected = Date.now()
      this.store.set('sessions', sessions)
    }
  }

  /** Get all group names */
  getGroups(): string[] {
    return this.store.get('groups', [])
  }

  /** Set group names */
  setGroups(groups: string[]): void {
    this.store.set('groups', groups)
  }

  /** Export sessions (without secrets) for sharing */
  exportSessions(): StoredSession[] {
    const sessions = this.getAll()
    return sessions.map((s) => {
      const exported = { ...s }
      // Strip secrets from auth
      if (exported.auth) {
        exported.auth = { ...exported.auth }
        delete exported.auth.password
        delete exported.auth.passphrase
        delete exported.auth.privateKeyData
        delete exported.auth.kbdiSavedResponses
      }
      // Strip proxy password
      if (exported.proxy) {
        exported.proxy = { ...exported.proxy }
        delete exported.proxy.password
      }
      // Strip connection override proxy password
      if (exported.overrides?.connection) {
        const connOverride = { ...exported.overrides.connection }
        delete connOverride.proxyPassword
        exported.overrides = {
          ...exported.overrides,
          connection: connOverride
        }
      }
      return exported
    })
  }

  /** Import sessions from JSON */
  importSessions(imported: StoredSession[]): number {
    const existing = this.store.get('sessions', [])
    const existingIds = new Set(existing.map((s) => s.id))

    let count = 0
    for (const session of imported) {
      if (!existingIds.has(session.id)) {
        existing.push(this.encryptSecrets(session))
        count++
      }
    }

    this.store.set('sessions', existing)
    return count
  }

  /** Encrypt all secret fields */
  private encryptSecrets(session: StoredSession): StoredSession {
    const result = { ...session }

    // Encrypt auth secrets
    if (result.auth) {
      result.auth = { ...result.auth }
      if (result.auth.password) {
        result.auth.password = encrypt(result.auth.password, this.masterKey)
      }
      if (result.auth.passphrase) {
        result.auth.passphrase = encrypt(result.auth.passphrase, this.masterKey)
      }
      if (result.auth.privateKeyData) {
        result.auth.privateKeyData = encrypt(result.auth.privateKeyData, this.masterKey)
      }
      if (result.auth.kbdiSavedResponses) {
        result.auth.kbdiSavedResponses = Object.fromEntries(
          Object.entries(result.auth.kbdiSavedResponses).map(([k, v]) => [
            k,
            encrypt(v, this.masterKey)
          ])
        )
      }
    }

    // Encrypt proxy password
    if (result.proxy?.password) {
      const pwd = result.proxy.password
      result.proxy = { ...result.proxy }
      result.proxy.password = encrypt(pwd, this.masterKey)
    }

    // Encrypt connection override proxy password
    if (result.overrides?.connection?.proxyPassword) {
      const pwd = result.overrides.connection.proxyPassword
      result.overrides = {
        ...result.overrides,
        connection: { ...result.overrides.connection, proxyPassword: encrypt(pwd, this.masterKey) }
      }
    }

    return result
  }

  /** Decrypt all secret fields */
  private decryptSecrets(session: StoredSession): StoredSession {
    const result = { ...session }

    try {
      // Decrypt auth secrets
      if (result.auth) {
        result.auth = { ...result.auth }
        if (result.auth.password) {
          result.auth.password = decrypt(result.auth.password, this.masterKey)
        }
        if (result.auth.passphrase) {
          result.auth.passphrase = decrypt(result.auth.passphrase, this.masterKey)
        }
        if (result.auth.privateKeyData) {
          result.auth.privateKeyData = decrypt(result.auth.privateKeyData, this.masterKey)
        }
        if (result.auth.kbdiSavedResponses) {
          result.auth.kbdiSavedResponses = Object.fromEntries(
            Object.entries(result.auth.kbdiSavedResponses).map(([k, v]) => {
              try {
                return [k, decrypt(v, this.masterKey)]
              } catch {
                return [k, '']
              }
            })
          )
        }
      }

      // Decrypt proxy password
      if (result.proxy?.password) {
        const pwd = result.proxy.password
        result.proxy = { ...result.proxy }
        result.proxy.password = decrypt(pwd, this.masterKey)
      }

      // Decrypt connection override proxy password
      if (result.overrides?.connection?.proxyPassword) {
        const pwd = result.overrides.connection.proxyPassword
        result.overrides = {
          ...result.overrides,
          connection: {
            ...result.overrides.connection,
            proxyPassword: decrypt(pwd, this.masterKey)
          }
        }
      }
    } catch {
      // If decryption fails, clear auth secrets
      if (result.auth) {
        result.auth.password = undefined
        result.auth.passphrase = undefined
        result.auth.privateKeyData = undefined
        result.auth.kbdiSavedResponses = undefined
      }
      if (result.proxy) {
        result.proxy.password = undefined
      }
    }

    return result
  }
}
