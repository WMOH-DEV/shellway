import { describe, expect, it } from 'vitest'
import { matchesFuzzy } from './fuzzyMatch'

describe('matchesFuzzy', () => {
  it('matches an empty or blank query', () => {
    expect(matchesFuzzy('', 'orders')).toBe(true)
    expect(matchesFuzzy('   ', 'orders')).toBe(true)
  })

  it('matches letters in order, ignoring case', () => {
    expect(matchesFuzzy('ORD', 'orders')).toBe(true)
    expect(matchesFuzzy('odr', 'orders')).toBe(true)
    expect(matchesFuzzy('dro', 'orders')).toBe(false)
  })

  it('requires every term, in any order', () => {
    expect(matchesFuzzy('auth users', 'users auth_db table')).toBe(true)
    expect(matchesFuzzy('users paid', 'users auth_db table')).toBe(false)
  })
})
