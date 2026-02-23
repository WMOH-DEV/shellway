import { app } from 'electron'
import { randomUUID } from 'crypto'
import { encrypt, decrypt } from '../utils/encryption'
import type { StoredSession, SessionStore } from './SessionStore'
import type { StoredSQLConfig, SQLConfigStore } from './SQLConfigStore'
import type { AppSettings, SettingsStore } from './SettingsStore'
import type { StoredSnippet, SnippetStore } from './SnippetStore'
import type { HostKeyStore } from './HostKeyStore'
import type { ClientKeyStore } from './ClientKeyStore'
import type { TrustedHostKey } from '../../src/types/hostkey'

export interface ExportedClientKey {
  id: string
  name: string
  keyType: string
  keySize: number
  fingerprint: string
  publicKey: string
  privateKeyData: string | null
  hasPassphrase: boolean
  passphrase: string | null
  comment?: string
  createdAt: number
  lastUsed?: number
}

// ── Export file types ──

export interface ShellwayExportFile {
  /** Format identifier */
  format: 'shellway-export'
  /** Schema version for future compatibility */
  version: 1
  /** When the export was created */
  exportedAt: number
  /** App version that created the export */
  appVersion: string
  /** Whether the file contains encrypted credentials */
  includesCredentials: boolean
  /** Whether the file is password-protected (entire payload encrypted) */
  isEncrypted: boolean
  /** The payload — either plaintext or encrypted string */
  payload: ShellwayExportPayload | string
}

export interface ShellwayExportPayload {
  sessions: StoredSession[]
  sqlConfigs: StoredSQLConfig[]
  settings: AppSettings | null
  snippets: StoredSnippet[]
  hostKeys: TrustedHostKey[]
  clientKeys: ExportedClientKey[]
  groups: string[]
  snippetCategories: string[]
}

// ── Options & results ──

export interface ExportOptions {
  includeSessions: boolean
  includeCredentials: boolean
  includeSQLConfigs: boolean
  includeSettings: boolean
  includeSnippets: boolean
  includeHostKeys: boolean
  includeClientKeys: boolean
  password?: string
}

export interface ImportOptions {
  importSessions: boolean
  importSQLConfigs: boolean
  importSettings: boolean
  importSnippets: boolean
  importHostKeys: boolean
  importClientKeys: boolean
  conflictResolution: 'skip' | 'overwrite' | 'duplicate'
  /** Session IDs to import (null = all) */
  selectedSessionIds: string[] | null
}

export interface ImportResult {
  sessions: { added: number; skipped: number; overwritten: number }
  sqlConfigs: { added: number; skipped: number; overwritten: number }
  settings: boolean
  snippets: { added: number; skipped: number }
  hostKeys: { added: number; skipped: number }
  clientKeys: { added: number; skipped: number; overwritten: number }
}

export interface ParsedImport {
  success: boolean
  error?: string
  data?: {
    format: string
    version: number
    exportedAt: number
    appVersion: string
    includesCredentials: boolean
    payload: ShellwayExportPayload
  }
}

// ── Service ──

export class ExportService {
  constructor(
    private sessionStore: SessionStore,
    private sqlConfigStore: SQLConfigStore,
    private settingsStore: SettingsStore,
    private snippetStore: SnippetStore,
    private hostKeyStore: HostKeyStore,
    private clientKeyStore: ClientKeyStore,
  ) {}

  // ── Export ──

  buildExport(options: ExportOptions): ShellwayExportFile {
    // 1. Gather data from each store
    let sessions: StoredSession[] = []
    let sqlConfigs: StoredSQLConfig[] = []
    let settings: AppSettings | null = null
    let snippets: StoredSnippet[] = []
    let hostKeys: TrustedHostKey[] = []
    let clientKeys: ExportedClientKey[] = []
    let groups: string[] = []
    let snippetCategories: string[] = []

    if (options.includeSessions) {
      sessions = this.sessionStore.getAll()
      groups = this.sessionStore.getGroups()
    }

    if (options.includeSQLConfigs) {
      const allConfigs = this.sqlConfigStore.getAll()
      // Filter out orphaned configs whose session no longer exists.
      // Standalone DB configs (sessionId starts with "db-") are always included
      // since they don't belong to any SSH session.
      const allSessionIds = new Set(this.sessionStore.getAll().map((s) => s.id))
      sqlConfigs = allConfigs.filter(
        (c) => c.sessionId.startsWith('db-') || allSessionIds.has(c.sessionId)
      )
    }

    if (options.includeSettings) {
      settings = this.settingsStore.getAll()
    }

    if (options.includeSnippets) {
      snippets = this.snippetStore.getAll()
      snippetCategories = this.snippetStore.getCategories()
    }

    if (options.includeHostKeys) {
      hostKeys = this.hostKeyStore.getAll()
    }

    if (options.includeClientKeys) {
      clientKeys = this.clientKeyStore.getAllDecryptedForExport()
    }

    // 2. Strip credentials if requested
    if (!options.includeCredentials) {
      sessions = sessions.map((s) => this.stripSessionCredentials(s))
      sqlConfigs = sqlConfigs.map((c) => this.stripSQLConfigCredentials(c))
      clientKeys = clientKeys.map(k => ({ ...k, privateKeyData: null, passphrase: null }))
    }

    // 3. Build payload
    const payload: ShellwayExportPayload = {
      sessions,
      sqlConfigs,
      settings,
      snippets,
      hostKeys,
      clientKeys,
      groups,
      snippetCategories,
    }

    // 4. Optionally encrypt
    const isEncrypted = !!options.password
    const finalPayload: ShellwayExportPayload | string = isEncrypted
      ? encrypt(JSON.stringify(payload), options.password!)
      : payload

    // 5. Build export file
    return {
      format: 'shellway-export',
      version: 1,
      exportedAt: Date.now(),
      appVersion: app.getVersion(),
      includesCredentials: options.includeCredentials,
      isEncrypted,
      payload: finalPayload,
    }
  }

  // ── Import: parse ──

  parseImport(fileContent: string, password?: string): ParsedImport {
    // 1. Parse JSON
    let file: ShellwayExportFile
    try {
      file = JSON.parse(fileContent)
    } catch {
      return { success: false, error: 'Invalid JSON: the file could not be parsed.' }
    }

    // 2. Validate format and version
    if (file.format !== 'shellway-export') {
      return {
        success: false,
        error: `Unrecognized file format: expected "shellway-export", got "${file.format}".`,
      }
    }

    if (file.version !== 1) {
      return {
        success: false,
        error: `Unsupported export version: expected 1, got ${file.version}. The file may have been created by a newer version of Shellway.`,
      }
    }

    // 3. Decrypt if needed
    let payload: ShellwayExportPayload
    if (file.isEncrypted) {
      if (!password) {
        return {
          success: false,
          error: 'This export file is password-protected. Please provide the password.',
        }
      }

      if (typeof file.payload !== 'string') {
        return {
          success: false,
          error: 'Invalid file: encrypted flag is set but payload is not a string.',
        }
      }

      try {
        const decrypted = decrypt(file.payload, password)
        payload = JSON.parse(decrypted)
      } catch {
        return {
          success: false,
          error: 'Decryption failed. The password may be incorrect or the file is corrupted.',
        }
      }
    } else {
      if (typeof file.payload === 'string') {
        return {
          success: false,
          error: 'Invalid file: payload is a string but encrypted flag is not set.',
        }
      }
      payload = file.payload
    }

    // 4. Validate payload structure
    const validationError = this.validatePayload(payload)
    if (validationError) {
      return { success: false, error: validationError }
    }

    // Normalize for backward compatibility (old exports may not have clientKeys)
    if (!Array.isArray(payload.clientKeys)) {
      payload.clientKeys = []
    }

    return {
      success: true,
      data: {
        format: file.format,
        version: file.version,
        exportedAt: file.exportedAt,
        appVersion: file.appVersion,
        includesCredentials: file.includesCredentials,
        payload,
      },
    }
  }

  // ── Import: apply ──

  applyImport(payload: ShellwayExportPayload, options: ImportOptions): ImportResult {
    const result: ImportResult = {
      sessions: { added: 0, skipped: 0, overwritten: 0 },
      sqlConfigs: { added: 0, skipped: 0, overwritten: 0 },
      settings: false,
      snippets: { added: 0, skipped: 0 },
      hostKeys: { added: 0, skipped: 0 },
      clientKeys: { added: 0, skipped: 0, overwritten: 0 },
    }

    // Each section is wrapped in try/catch so a failure in one area
    // doesn't prevent the others from importing. The result always
    // reflects what actually succeeded.

    // 1. Import sessions + SQL configs
    try {
      if (options.importSessions) {
        const sessionsToImport = options.selectedSessionIds
          ? payload.sessions.filter((s) => options.selectedSessionIds!.includes(s.id))
          : payload.sessions

        // Build a map of original ID → new ID for duplicate mode (used for SQL config mapping)
        const idMap = new Map<string, string>()

        for (const session of sessionsToImport) {
          if (!this.isValidSession(session)) {
            result.sessions.skipped++
            continue
          }

          const existing = this.sessionStore.getById(session.id)

          if (existing) {
            switch (options.conflictResolution) {
              case 'skip':
                result.sessions.skipped++
                break

              case 'overwrite':
                this.sessionStore.update(session.id, session)
                idMap.set(session.id, session.id)
                result.sessions.overwritten++
                break

              case 'duplicate': {
                const newId = randomUUID()
                idMap.set(session.id, newId)
                const duplicated: StoredSession = {
                  ...session,
                  id: newId,
                  name: `${session.name} (imported)`,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                }
                this.sessionStore.create(duplicated)
                result.sessions.added++
                break
              }
            }
          } else {
            idMap.set(session.id, session.id)
            this.sessionStore.create(session)
            result.sessions.added++
          }
        }

        // Import groups (merge with existing)
        if (payload.groups.length > 0) {
          const existingGroups = this.sessionStore.getGroups()
          const merged = [...new Set([...existingGroups, ...payload.groups])]
          this.sessionStore.setGroups(merged)
        }

        // 2. Import SQL configs (matched by sessionId, respecting idMap)
        if (options.importSQLConfigs) {
          for (const config of payload.sqlConfigs) {
            // Standalone DB configs (sessionId starts with "db-") are imported
            // directly — they don't belong to any SSH session.
            const isStandalone = config.sessionId.startsWith('db-')

            if (isStandalone) {
              const existingConfig = this.sqlConfigStore.get(config.sessionId)

              if (existingConfig) {
                switch (options.conflictResolution) {
                  case 'skip':
                    result.sqlConfigs.skipped++
                    break

                  case 'overwrite':
                    this.sqlConfigStore.save(config)
                    result.sqlConfigs.overwritten++
                    break

                  case 'duplicate': {
                    const newSessionId = `db-${randomUUID()}`
                    this.sqlConfigStore.save({
                      ...config,
                      sessionId: newSessionId,
                      connectionName: `${config.connectionName || 'Database'} (imported)`,
                    })
                    result.sqlConfigs.added++
                    break
                  }
                }
              } else {
                this.sqlConfigStore.save(config)
                result.sqlConfigs.added++
              }
              continue
            }

            const mappedId = idMap.get(config.sessionId)

            // Only import configs whose session was imported (or exists)
            if (!mappedId) {
              const sessionExists = this.sessionStore.getById(config.sessionId)
              if (!sessionExists) {
                result.sqlConfigs.skipped++
                continue
              }
            }

            const targetSessionId = mappedId ?? config.sessionId
            const existingConfig = this.sqlConfigStore.get(targetSessionId)

            if (existingConfig) {
              switch (options.conflictResolution) {
                case 'skip':
                  result.sqlConfigs.skipped++
                  break

                case 'overwrite':
                case 'duplicate':
                  this.sqlConfigStore.save({ ...config, sessionId: targetSessionId })
                  result.sqlConfigs.overwritten++
                  break
              }
            } else {
              this.sqlConfigStore.save({ ...config, sessionId: targetSessionId })
              result.sqlConfigs.added++
            }
          }
        }
      } else if (options.importSQLConfigs) {
        // Import SQL configs even when sessions are not being imported
        for (const config of payload.sqlConfigs) {
          const existingConfig = this.sqlConfigStore.get(config.sessionId)

          if (existingConfig) {
            switch (options.conflictResolution) {
              case 'skip':
                result.sqlConfigs.skipped++
                break

              case 'overwrite':
                this.sqlConfigStore.save(config)
                result.sqlConfigs.overwritten++
                break

              case 'duplicate': {
                // For standalone configs, generate a new sessionId.
                // For SSH-session configs, use the same sessionId (only one config per session).
                if (config.sessionId.startsWith('db-')) {
                  const newSessionId = `db-${randomUUID()}`
                  this.sqlConfigStore.save({
                    ...config,
                    sessionId: newSessionId,
                    connectionName: `${config.connectionName || 'Database'} (imported)`,
                  })
                  result.sqlConfigs.added++
                } else {
                  this.sqlConfigStore.save(config)
                  result.sqlConfigs.overwritten++
                }
                break
              }
            }
          } else {
            this.sqlConfigStore.save(config)
            result.sqlConfigs.added++
          }
        }
      }
    } catch {
      // Session/SQL config import failed partway — result reflects what succeeded
    }

    // 3. Import settings (validate keys against known schema)
    try {
      if (options.importSettings && payload.settings) {
        const currentSettings = this.settingsStore.getAll()
        const knownKeys = new Set(Object.keys(currentSettings))
        const sanitized: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(payload.settings as unknown as Record<string, unknown>)) {
          if (knownKeys.has(key)) {
            sanitized[key] = value
          }
        }
        if (Object.keys(sanitized).length > 0) {
          this.settingsStore.update(sanitized as Partial<AppSettings>)
          result.settings = true
        }
      }
    } catch {
      // Settings import failed — continue with other sections
    }

    // 4. Import snippets
    try {
      if (options.importSnippets) {
        const existingSnippets = this.snippetStore.getAll()
        const existingIds = new Set(existingSnippets.map((s) => s.id))

        for (const snippet of payload.snippets) {
          if (existingIds.has(snippet.id)) {
            switch (options.conflictResolution) {
              case 'skip':
                result.snippets.skipped++
                break
              case 'overwrite':
                this.snippetStore.update(snippet.id, snippet)
                result.snippets.added++
                break
              case 'duplicate': {
                const newId = randomUUID()
                this.snippetStore.create({
                  ...snippet,
                  id: newId,
                  name: `${snippet.name} (imported)`,
                })
                result.snippets.added++
                break
              }
            }
          } else {
            this.snippetStore.create(snippet)
            result.snippets.added++
          }
        }
      }
    } catch {
      // Snippet import failed — continue with other sections
    }

    // 5. Import host keys
    try {
      if (options.importHostKeys) {
        for (const key of payload.hostKeys) {
          const existingKeys = this.hostKeyStore.getByHost(key.host, key.port)
          const isDuplicate = existingKeys.some(
            (k) => k.keyType === key.keyType && k.fingerprint === key.fingerprint
          )

          if (isDuplicate) {
            result.hostKeys.skipped++
          } else {
            this.hostKeyStore.add({
              host: key.host,
              port: key.port,
              keyType: key.keyType,
              fingerprint: key.fingerprint,
              publicKeyBase64: key.publicKeyBase64,
              comment: key.comment,
            })
            result.hostKeys.added++
          }
        }
      }
    } catch {
      // Host key import failed — result reflects what succeeded
    }

    // 6. Import client keys
    try {
      if (options.importClientKeys && payload.clientKeys?.length > 0) {
        const clientKeyResult = this.clientKeyStore.importFromExport(
          payload.clientKeys,
          options.conflictResolution
        )
        result.clientKeys = clientKeyResult
      }
    } catch {
      // Client key import failed — result reflects what succeeded
    }

    return result
  }

  // ── Private helpers ──

  private stripSessionCredentials(session: StoredSession): StoredSession {
    const stripped = { ...session }

    if (stripped.auth) {
      stripped.auth = { ...stripped.auth }
      delete stripped.auth.password
      delete stripped.auth.passphrase
      delete stripped.auth.privateKeyData
      delete stripped.auth.kbdiSavedResponses
    }

    if (stripped.proxy) {
      stripped.proxy = { ...stripped.proxy }
      delete stripped.proxy.password
    }

    if (stripped.overrides?.connection) {
      const connOverride = { ...stripped.overrides.connection }
      delete connOverride.proxyPassword
      stripped.overrides = {
        ...stripped.overrides,
        connection: connOverride,
      }
    }

    return stripped
  }

  private stripSQLConfigCredentials(config: StoredSQLConfig): StoredSQLConfig {
    return {
      ...config,
      password: '',
      sshPassword: undefined,
      sshPassphrase: undefined,
    }
  }

  private validatePayload(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return 'Invalid payload: expected an object.'
    }

    const p = payload as Record<string, unknown>

    if (!Array.isArray(p.sessions)) {
      return 'Invalid payload: "sessions" must be an array.'
    }

    if (!Array.isArray(p.sqlConfigs)) {
      return 'Invalid payload: "sqlConfigs" must be an array.'
    }

    if (p.settings !== null && typeof p.settings !== 'object') {
      return 'Invalid payload: "settings" must be an object or null.'
    }

    if (!Array.isArray(p.snippets)) {
      return 'Invalid payload: "snippets" must be an array.'
    }

    if (!Array.isArray(p.hostKeys)) {
      return 'Invalid payload: "hostKeys" must be an array.'
    }

    // clientKeys is optional for backward compatibility (old exports won't have it)
    if (p.clientKeys !== undefined && !Array.isArray(p.clientKeys)) {
      return 'Invalid payload: "clientKeys" must be an array.'
    }

    if (!Array.isArray(p.groups)) {
      return 'Invalid payload: "groups" must be an array.'
    }

    if (!Array.isArray(p.snippetCategories)) {
      return 'Invalid payload: "snippetCategories" must be an array.'
    }

    return null
  }

  private isValidSession(session: StoredSession): boolean {
    if (!session.id || typeof session.id !== 'string') return false
    if (!session.name || typeof session.name !== 'string') return false
    if (!session.host || typeof session.host !== 'string') return false
    if (typeof session.port !== 'number' || session.port < 1 || session.port > 65535) return false
    if (!session.username || typeof session.username !== 'string') return false
    return true
  }
}
