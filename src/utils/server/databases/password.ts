const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
const LENGTH = 24
const SYMBOL = '_'
const UNBIASED_LIMIT = 256 - (256 % ALPHABET.length)
const HAS_EVERY_CLASS = [/[A-Z]/, /[a-z]/, /[0-9]/]

function randomCharacters(length: number): string {
  let text = ''
  while (text.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2))
    for (const byte of bytes) {
      if (byte < UNBIASED_LIMIT && text.length < length) text += ALPHABET[byte % ALPHABET.length]
    }
  }
  return text
}

function randomIndex(below: number): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] % below
}

export function generatePassword(): string {
  let letters = randomCharacters(LENGTH - 1)
  while (!HAS_EVERY_CLASS.every((pattern) => pattern.test(letters))) letters = randomCharacters(LENGTH - 1)
  const at = randomIndex(LENGTH)
  return `${letters.slice(0, at)}${SYMBOL}${letters.slice(at)}`
}
