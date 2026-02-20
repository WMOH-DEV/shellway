/** A client SSH key pair stored in the key manager */
export interface ClientKey {
  id: string
  /** Display name (e.g. "My VPS Key", "Production Deploy") */
  name: string
  /** Key type: rsa, ed25519, ecdsa */
  keyType: 'rsa' | 'ed25519' | 'ecdsa'
  /** Key size in bits (RSA: 2048/4096, ed25519: 256, etc.) */
  keySize: number
  /** SHA256 fingerprint of the public key */
  fingerprint: string
  /** Public key in OpenSSH format (ssh-rsa AAAA... comment) */
  publicKey: string
  /** Private key data (PEM format, encrypted at rest in the store) */
  privateKeyEncrypted: string
  /** Whether the private key has a passphrase */
  hasPassphrase: boolean
  /** Optional passphrase (encrypted at rest — only stored if user opts in) */
  passphraseEncrypted?: string
  /** User-added note */
  comment?: string
  /** When the key was imported/created */
  createdAt: number
  /** Last time the key was used for authentication */
  lastUsed?: number
}

/** Minimal info for UI dropdowns (no sensitive data) */
export interface ClientKeyInfo {
  id: string
  name: string
  keyType: string
  keySize: number
  fingerprint: string
  publicKey: string
  hasPassphrase: boolean
  comment?: string
  createdAt: number
  lastUsed?: number
}
