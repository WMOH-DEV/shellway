/** A trusted SSH host key stored in the host key database */
export interface TrustedHostKey {
  id: string
  host: string
  port: number
  keyType: string                // ssh-rsa, ssh-ed25519, ecdsa-sha2-nistp256, etc.
  fingerprint: string            // SHA256 fingerprint
  publicKeyBase64: string        // Full public key data
  trustedAt: number              // Timestamp when first trusted
  lastSeen: number               // Timestamp of last connection using this key
  comment?: string               // User-added note
}
