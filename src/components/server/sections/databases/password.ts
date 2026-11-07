const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
const LENGTH = 24
const UNBIASED_LIMIT = 256 - (256 % ALPHABET.length)

export function generatePassword(): string {
  let password = ''
  while (password.length < LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(LENGTH * 2))
    for (const byte of bytes) {
      if (byte < UNBIASED_LIMIT && password.length < LENGTH) password += ALPHABET[byte % ALPHABET.length]
    }
  }
  return password
}
