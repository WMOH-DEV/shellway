import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const TAG_LENGTH = 16
const SALT_LENGTH = 32
const KEY_LENGTH = 32
const ITERATIONS = 100_000

/**
 * Derive a 256-bit encryption key from a password using PBKDF2.
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha512')
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a base64 string containing: salt + iv + authTag + ciphertext
 */
export function encrypt(plaintext: string, password: string): string {
  const salt = randomBytes(SALT_LENGTH)
  const key = deriveKey(password, salt)
  const iv = randomBytes(IV_LENGTH)

  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  // Concatenate: salt + iv + tag + ciphertext
  const combined = Buffer.concat([salt, iv, tag, encrypted])
  return combined.toString('base64')
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * Input should be the base64 string produced by encrypt().
 */
export function decrypt(encryptedBase64: string, password: string): string {
  const combined = Buffer.from(encryptedBase64, 'base64')

  const salt = combined.subarray(0, SALT_LENGTH)
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
  const tag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
  const ciphertext = combined.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH)

  const key = deriveKey(password, salt)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString('utf8')
}

/**
 * Generate a random encryption key string (used as default master key).
 */
export function generateMasterKey(): string {
  return randomBytes(32).toString('hex')
}
