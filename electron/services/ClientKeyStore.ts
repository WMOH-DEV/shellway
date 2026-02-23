import Store from 'electron-store'
import { randomUUID, createHash, createPublicKey } from 'crypto'
import { readFileSync } from 'fs'
import { encrypt, decrypt, generateMasterKey } from '../utils/encryption'
import type { ClientKey, ClientKeyInfo } from '../../src/types/clientkey'

interface ClientKeyStoreSchema {
  clientKeys: ClientKey[]
  masterKey: string
}

/**
 * ClientKeyStore — persists SSH client key pairs using electron-store.
 *
 * Private keys and passphrases are encrypted at rest using AES-256-GCM.
 * This is the Shellway equivalent of Bitvise's "Client Key Manager".
 */
export class ClientKeyStore {
  private store: Store<ClientKeyStoreSchema>
  private masterKey: string

  constructor() {
    this.store = new Store<ClientKeyStoreSchema>({
      name: 'shellway-clientkeys',
      defaults: {
        clientKeys: [],
        masterKey: generateMasterKey()
      }
    })
    this.masterKey = this.store.get('masterKey')
  }

  /** Get all client keys (with sensitive data stripped for UI) */
  getAllInfo(): ClientKeyInfo[] {
    return this.store.get('clientKeys', []).map((k) => ({
      id: k.id,
      name: k.name,
      keyType: k.keyType,
      keySize: k.keySize,
      fingerprint: k.fingerprint,
      publicKey: k.publicKey,
      hasPassphrase: k.hasPassphrase,
      comment: k.comment,
      createdAt: k.createdAt,
      lastUsed: k.lastUsed
    }))
  }

  /** Get a single key's full data (decrypted private key) */
  getDecrypted(id: string): { privateKey: string; passphrase?: string } | null {
    const keys = this.store.get('clientKeys', [])
    const key = keys.find((k) => k.id === id)
    if (!key) return null

    try {
      const privateKey = decrypt(key.privateKeyEncrypted, this.masterKey)
      const passphrase = key.passphraseEncrypted
        ? decrypt(key.passphraseEncrypted, this.masterKey)
        : undefined
      return { privateKey, passphrase }
    } catch {
      return null
    }
  }

  /** Import a key from a file path */
  importFromFile(
    filePath: string,
    name: string,
    passphrase?: string,
    savePassphrase?: boolean
  ): ClientKeyInfo {
    const privateKeyData = readFileSync(filePath, 'utf-8')
    return this.importFromData(privateKeyData, name, passphrase, savePassphrase)
  }

  /** Import a key from raw PEM/OpenSSH data */
  importFromData(
    privateKeyData: string,
    name: string,
    passphrase?: string,
    savePassphrase?: boolean
  ): ClientKeyInfo {
    const { keyType, keySize, fingerprint, publicKey } = this.analyzeKey(privateKeyData, passphrase)

    // Check for duplicates by fingerprint
    const existing = this.store.get('clientKeys', [])
    const duplicate = existing.find((k) => k.fingerprint === fingerprint)
    if (duplicate) {
      throw new Error(`A key with this fingerprint already exists: "${duplicate.name}"`)
    }

    const now = Date.now()
    const entry: ClientKey = {
      id: randomUUID(),
      name: name || `${keyType}-${now}`,
      keyType,
      keySize,
      fingerprint,
      publicKey,
      privateKeyEncrypted: encrypt(privateKeyData, this.masterKey),
      hasPassphrase: !!passphrase,
      passphraseEncrypted: (passphrase && savePassphrase)
        ? encrypt(passphrase, this.masterKey)
        : undefined,
      createdAt: now
    }

    existing.push(entry)
    this.store.set('clientKeys', existing)

    return {
      id: entry.id,
      name: entry.name,
      keyType: entry.keyType,
      keySize: entry.keySize,
      fingerprint: entry.fingerprint,
      publicKey: entry.publicKey,
      hasPassphrase: entry.hasPassphrase,
      comment: entry.comment,
      createdAt: entry.createdAt,
      lastUsed: entry.lastUsed
    }
  }

  /** Remove a key by ID */
  remove(id: string): boolean {
    const keys = this.store.get('clientKeys', [])
    const filtered = keys.filter((k) => k.id !== id)
    if (filtered.length === keys.length) return false
    this.store.set('clientKeys', filtered)
    return true
  }

  /** Update key metadata (name, comment) */
  update(id: string, updates: { name?: string; comment?: string }): boolean {
    const keys = this.store.get('clientKeys', [])
    const key = keys.find((k) => k.id === id)
    if (!key) return false

    if (updates.name !== undefined) key.name = updates.name
    if (updates.comment !== undefined) key.comment = updates.comment
    this.store.set('clientKeys', keys)
    return true
  }

  /** Update the lastUsed timestamp */
  touchLastUsed(id: string): void {
    const keys = this.store.get('clientKeys', [])
    const key = keys.find((k) => k.id === id)
    if (key) {
      key.lastUsed = Date.now()
      this.store.set('clientKeys', keys)
    }
  }

  /** Get all keys with private key data decrypted (for export). Returns null values for keys that can't be decrypted. */
  getAllDecryptedForExport(): Array<{
    id: string
    name: string
    keyType: 'rsa' | 'ed25519' | 'ecdsa'
    keySize: number
    fingerprint: string
    publicKey: string
    privateKeyData: string | null
    hasPassphrase: boolean
    passphrase: string | null
    comment?: string
    createdAt: number
    lastUsed?: number
  }> {
    const keys = this.store.get('clientKeys', [])
    return keys.map(k => {
      let privateKeyData: string | null = null
      let passphrase: string | null = null
      try {
        privateKeyData = decrypt(k.privateKeyEncrypted, this.masterKey)
        if (k.passphraseEncrypted) {
          passphrase = decrypt(k.passphraseEncrypted, this.masterKey)
        }
      } catch {
        // Can't decrypt — will be null
      }
      return {
        id: k.id,
        name: k.name,
        keyType: k.keyType,
        keySize: k.keySize,
        fingerprint: k.fingerprint,
        publicKey: k.publicKey,
        privateKeyData,
        hasPassphrase: k.hasPassphrase,
        passphrase,
        comment: k.comment,
        createdAt: k.createdAt,
        lastUsed: k.lastUsed,
      }
    })
  }

  /** Import client keys from decrypted export data, encrypting with this instance's master key */
  importFromExport(
    keys: Array<{
      id: string; name: string; keyType: string; keySize: number;
      fingerprint: string; publicKey: string;
      privateKeyData: string | null; hasPassphrase: boolean; passphrase: string | null;
      comment?: string; createdAt: number; lastUsed?: number;
    }>,
    conflictResolution: 'skip' | 'overwrite' | 'duplicate'
  ): { added: number; skipped: number; overwritten: number } {
    const existing = this.store.get('clientKeys', [])
    const result = { added: 0, skipped: 0, overwritten: 0 }

    for (const key of keys) {
      if (!key.privateKeyData) {
        result.skipped++ // Can't import without private key
        continue
      }

      const entry: ClientKey = {
        id: key.id,
        name: key.name,
        keyType: key.keyType as 'rsa' | 'ed25519' | 'ecdsa',
        keySize: key.keySize,
        fingerprint: key.fingerprint,
        publicKey: key.publicKey,
        privateKeyEncrypted: encrypt(key.privateKeyData, this.masterKey),
        hasPassphrase: key.hasPassphrase,
        passphraseEncrypted: key.passphrase ? encrypt(key.passphrase, this.masterKey) : undefined,
        comment: key.comment,
        createdAt: key.createdAt,
        lastUsed: key.lastUsed,
      }

      const existingIdx = existing.findIndex(k => k.id === key.id)
      const fingerprintIdx = existing.findIndex(k => k.fingerprint === key.fingerprint)

      if (existingIdx >= 0 || fingerprintIdx >= 0) {
        switch (conflictResolution) {
          case 'skip':
            result.skipped++
            break
          case 'overwrite': {
            const idx = existingIdx >= 0 ? existingIdx : fingerprintIdx
            // When overwriting by fingerprint match (not ID match), preserve the existing key's ID
            // so that local sessions referencing the old key ID don't get broken
            if (existingIdx < 0 && fingerprintIdx >= 0) {
              entry.id = existing[fingerprintIdx].id
            }
            existing[idx] = entry
            result.overwritten++
            break
          }
          case 'duplicate': {
            entry.id = randomUUID()
            entry.name = `${key.name} (imported)`
            existing.push(entry)
            result.added++
            break
          }
        }
      } else {
        existing.push(entry)
        result.added++
      }
    }

    this.store.set('clientKeys', existing)
    return result
  }

  /** Analyze a private key to extract type, size, fingerprint, and public key */
  private analyzeKey(
    privateKeyData: string,
    passphrase?: string
  ): {
    keyType: 'rsa' | 'ed25519' | 'ecdsa'
    keySize: number
    fingerprint: string
    publicKey: string
  } {
    try {
      // Use Node.js crypto to parse the key — createPublicKey can derive public from private
      const keyObj = createPublicKey({
        key: privateKeyData,
        passphrase: passphrase
      } as any)

      // Export public key in SPKI DER format for fingerprinting
      const spkiDer = keyObj.export({ type: 'spki', format: 'der' })
      const fingerprint = 'SHA256:' + createHash('sha256').update(spkiDer).digest('base64').replace(/=+$/, '')

      // Export public key in PEM format
      let publicKey: string
      try {
        publicKey = keyObj.export({ type: 'spki', format: 'pem' }) as string
      } catch {
        publicKey = spkiDer.toString('base64')
      }

      // Determine key type and size
      const asymType = keyObj.asymmetricKeyType
      let keyType: 'rsa' | 'ed25519' | 'ecdsa' = 'rsa'
      let keySize = 0

      if (asymType === 'rsa') {
        keyType = 'rsa'
        // symmetricKeySize is undefined for asymmetric keys; use detail or default
        keySize = (keyObj as any).asymmetricKeySize ?? 2048
      } else if (asymType === 'ed25519' || asymType === 'x25519') {
        keyType = 'ed25519'
        keySize = 256
      } else if (asymType === 'ec') {
        keyType = 'ecdsa'
        keySize = (keyObj as any).asymmetricKeySize ?? 256
      }

      return { keyType, keySize, fingerprint, publicKey }
    } catch {
      // Fallback: try to detect type from the PEM header
      let keyType: 'rsa' | 'ed25519' | 'ecdsa' = 'rsa'
      if (privateKeyData.includes('OPENSSH')) {
        // Parse OpenSSH format key type from the data
        if (privateKeyData.includes('ssh-ed25519') || privateKeyData.includes('ed25519')) {
          keyType = 'ed25519'
        } else if (privateKeyData.includes('ecdsa')) {
          keyType = 'ecdsa'
        }
      } else if (privateKeyData.includes('EC PRIVATE KEY')) {
        keyType = 'ecdsa'
      }

      // Generate a fingerprint from the raw data
      const fingerprint = 'SHA256:' + createHash('sha256')
        .update(privateKeyData)
        .digest('base64')
        .replace(/=+$/, '')

      return {
        keyType,
        keySize: keyType === 'rsa' ? 2048 : keyType === 'ed25519' ? 256 : 256,
        fingerprint,
        publicKey: '(public key extraction failed — key is still usable for auth)'
      }
    }
  }
}
