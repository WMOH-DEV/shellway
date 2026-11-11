import { beforeEach, describe, expect, it } from 'vitest'
import { subTabForIntent, useSearchIntentStore } from './intentStore'

describe('useSearchIntentStore', () => {
  beforeEach(() => useSearchIntentStore.setState({ pending: {} }))

  it('takes only the requested kinds for a session', () => {
    const { push, take } = useSearchIntentStore.getState()
    push('s1', { kind: 'open-table', database: 'shop', table: 'orders', newTab: false })
    push('s1', { kind: 'sftp-reveal', path: '/var/www' })
    push('s2', { kind: 'sftp-reveal', path: '/srv' })

    expect(take('s1', ['sftp-reveal', 'sftp-open'])).toEqual([{ kind: 'sftp-reveal', path: '/var/www' }])
    expect(useSearchIntentStore.getState().pending.s1).toHaveLength(1)
    expect(useSearchIntentStore.getState().pending.s2).toHaveLength(1)
  })

  it('returns nothing and keeps state when no intent matches', () => {
    const before = useSearchIntentStore.getState().pending
    expect(useSearchIntentStore.getState().take('s1', ['open-sql'])).toEqual([])
    expect(useSearchIntentStore.getState().pending).toBe(before)
  })
})

describe('subTabForIntent', () => {
  it.each([
    ['open-table', 'sql'],
    ['sql-action', 'sql'],
    ['sftp-open', 'sftp'],
    ['terminal-insert', 'terminal']
  ] as const)('%s opens %s', (kind, subTab) => {
    expect(subTabForIntent(kind)).toBe(subTab)
  })
})
