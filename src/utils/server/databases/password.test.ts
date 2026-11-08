import { describe, expect, it } from 'vitest'
import { DB_PASSWORD } from './identifiers'
import { generatePassword } from './password'

describe('generatePassword', () => {
  it('always has upper and lower case letters, a digit and a symbol, so MySQL password policies accept it', () => {
    for (let i = 0; i < 200; i += 1) {
      const password = generatePassword()
      expect(password).toMatch(DB_PASSWORD)
      expect(password).toHaveLength(24)
      for (const pattern of [/[A-Z]/, /[a-z]/, /[0-9]/, /_/]) expect(password).toMatch(pattern)
    }
  })
})
