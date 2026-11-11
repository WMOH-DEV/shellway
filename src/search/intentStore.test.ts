import { beforeEach, describe, expect, it } from 'vitest'
import { useSearchIntentStore } from './intentStore'

describe('useSearchIntentStore', () => {
  beforeEach(() => useSearchIntentStore.setState({ pending: {} }))

  it('takes only the requested kinds for a tab', () => {
    const { push, take } = useSearchIntentStore.getState()
    push('t1', { kind: 'open-table', database: 'shop', table: 'orders', newTab: false })
    push('t1', { kind: 'sftp-reveal', path: '/var/www' })
    push('t2', { kind: 'sftp-reveal', path: '/srv' })

    expect(take('t1', ['sftp-reveal', 'sftp-open'])).toEqual([{ kind: 'sftp-reveal', path: '/var/www' }])
    expect(useSearchIntentStore.getState().pending.t1).toHaveLength(1)
    expect(useSearchIntentStore.getState().pending.t2).toHaveLength(1)
  })

  it('returns nothing and keeps state when no intent matches', () => {
    const before = useSearchIntentStore.getState().pending
    expect(useSearchIntentStore.getState().take('t1', ['open-sql'])).toEqual([])
    expect(useSearchIntentStore.getState().pending).toBe(before)
  })
})
