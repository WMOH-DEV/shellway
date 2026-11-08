import { describe, expect, it } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { softwareAttention } from './attention'
import { UPDATES_DEBIAN, UPDATES_UBUNTU, USAGE } from './fixtures/outputs'
import { UPDATES_PROBE, USAGE_PROBE } from './types'
import { parseUpdates } from './updates'
import { parseUsage } from './usage'

const ok = (data: unknown) => ({ status: 'ok' as const, data, at: 1 })

describe('softwareAttention', () => {
  it('ranks security updates, fpm pressure, reboot and regular updates', () => {
    const facts: ServerFacts = { [UPDATES_PROBE]: ok(parseUpdates(UPDATES_UBUNTU)), [USAGE_PROBE]: ok(parseUsage(USAGE)) }
    const items = softwareAttention(facts).sort((a, b) => b.rank - a.rank)
    expect(items.map((item) => [item.id, item.level, item.rank])).toEqual([
      ['software.security-updates', 'warning', 70],
      ['software.fpm-pressure.8.3', 'warning', 65],
      ['software.reboot', 'warning', 60],
      ['software.updates', 'info', 20]
    ])
    expect(items[0].title).toBe('2 security updates')
    expect(items[1].route).toEqual({ section: 'software', sub: 'php', params: { version: '8.3' } })
  })

  it('uses singular wording and skips missing facts', () => {
    const items = softwareAttention({ [UPDATES_PROBE]: ok(parseUpdates(UPDATES_DEBIAN)) })
    expect(items.map((item) => item.title)).toEqual(['1 security update', '1 update'])
    expect(softwareAttention({})).toEqual([])
  })
})
