import Store from 'electron-store'
import { randomUUID } from 'crypto'
import type { TrustedHostKey } from '../../src/types/hostkey'

interface HostKeyStoreSchema {
  trustedKeys: TrustedHostKey[]
}

/** Result of verifying a host key against the trusted store */
export type HostKeyVerifyResult =
  | { status: 'trusted' }
  | { status: 'new' }
  | { status: 'changed'; previousKey: TrustedHostKey }

/**
 * HostKeyStore — persists trusted SSH host keys using electron-store.
 *
 * Implements trust-on-first-use (TOFU) verification and supports
 * import/export in OpenSSH known_hosts format.
 */
export class HostKeyStore {
  private store: Store<HostKeyStoreSchema>

  constructor() {
    this.store = new Store<HostKeyStoreSchema>({
      name: 'shellway-hostkeys',
      defaults: {
        trustedKeys: []
      }
    })
  }

  /** Get all trusted host keys */
  getAll(): TrustedHostKey[] {
    return this.store.get('trustedKeys', [])
  }

  /** Get trusted keys for a specific host:port */
  getByHost(host: string, port: number): TrustedHostKey[] {
    return this.getAll().filter((k) => k.host === host && k.port === port)
  }

  /** Add a new trusted host key */
  add(key: Omit<TrustedHostKey, 'id' | 'trustedAt' | 'lastSeen'>): TrustedHostKey {
    const now = Date.now()
    const entry: TrustedHostKey = {
      ...key,
      id: randomUUID(),
      trustedAt: now,
      lastSeen: now
    }

    const keys = this.getAll()
    keys.push(entry)
    this.store.set('trustedKeys', keys)
    return entry
  }

  /** Remove a trusted host key by ID */
  remove(id: string): boolean {
    const keys = this.getAll()
    const filtered = keys.filter((k) => k.id !== id)
    if (filtered.length === keys.length) return false
    this.store.set('trustedKeys', filtered)
    return true
  }

  /** Remove all trusted keys for a specific host:port */
  removeAllForHost(host: string, port: number): number {
    const keys = this.getAll()
    const filtered = keys.filter((k) => !(k.host === host && k.port === port))
    const removed = keys.length - filtered.length
    this.store.set('trustedKeys', filtered)
    return removed
  }

  /** Update the lastSeen timestamp for a key */
  updateLastSeen(id: string): void {
    const keys = this.getAll()
    const key = keys.find((k) => k.id === id)
    if (key) {
      key.lastSeen = Date.now()
      this.store.set('trustedKeys', keys)
    }
  }

  /** Update or set a comment on a trusted key */
  updateComment(id: string, comment: string): void {
    const keys = this.getAll()
    const key = keys.find((k) => k.id === id)
    if (key) {
      key.comment = comment
      this.store.set('trustedKeys', keys)
    }
  }

  /**
   * Verify a host key against the trusted store.
   * Returns 'trusted' if known and matching, 'new' if unknown, 'changed' if mismatch.
   */
  verify(
    host: string,
    port: number,
    keyType: string,
    fingerprint: string,
    _publicKeyBase64: string
  ): HostKeyVerifyResult {
    const existing = this.getByHost(host, port)

    if (existing.length === 0) {
      return { status: 'new' }
    }

    // Check if we have a matching key type+fingerprint
    const match = existing.find(
      (k) => k.keyType === keyType && k.fingerprint === fingerprint
    )

    if (match) {
      // Trusted — update lastSeen
      this.updateLastSeen(match.id)
      return { status: 'trusted' }
    }

    // We have keys for this host, but the fingerprint doesn't match any.
    // Find the most recent key of the same type (if any) or the most recent overall.
    const sameType = existing.find((k) => k.keyType === keyType)
    const previousKey = sameType ?? existing[0]

    return { status: 'changed', previousKey }
  }

  /** Export all trusted keys in OpenSSH known_hosts format */
  exportKnownHosts(): string {
    const keys = this.getAll()
    return keys
      .map((k) => {
        const hostStr = k.port === 22 ? k.host : `[${k.host}]:${k.port}`
        return `${hostStr} ${k.keyType} ${k.publicKeyBase64}`
      })
      .join('\n')
  }

  /**
   * Import keys from OpenSSH known_hosts format.
   * Returns the number of newly imported keys (duplicates skipped).
   */
  importKnownHosts(content: string): number {
    const lines = content.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
    let imported = 0

    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 3) continue

      const [hostPart, keyType, publicKeyBase64] = parts

      let host: string
      let port: number

      // Parse [host]:port or host format
      const bracketMatch = hostPart.match(/^\[(.+)\]:(\d+)$/)
      if (bracketMatch) {
        host = bracketMatch[1]
        port = parseInt(bracketMatch[2], 10)
      } else {
        host = hostPart
        port = 22
      }

      // Skip if we already have this exact key
      const existing = this.getByHost(host, port)
      const isDuplicate = existing.some(
        (k) => k.keyType === keyType && k.publicKeyBase64 === publicKeyBase64
      )

      if (!isDuplicate) {
        this.add({
          host,
          port,
          keyType,
          fingerprint: '', // Fingerprint not available from known_hosts format
          publicKeyBase64,
          comment: 'Imported from known_hosts'
        })
        imported++
      }
    }

    return imported
  }
}
