import { describe, expect, it } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { softwareChips } from './software'

describe('softwareChips', () => {
  it('reads installed components from software probes and highlights updates', () => {
    const facts: ServerFacts = {
      'software.installed': {
        status: 'ok',
        at: 1,
        data: [
          { name: 'nginx', version: '1.24.0-2ubuntu7' },
          { name: 'composer', version: '2.8.1', candidate: '2.8.3' },
          { name: 'PHP', version: '8.3.6', updateAvailable: true },
          { name: 'redis', version: '' },
          'noise'
        ]
      },
      'software.extra': { status: 'ok', at: 1, data: { components: [{ name: 'Docker', version: '27.3.1', candidate: '27.3.1' }] } },
      'software.failed': { status: 'error', error: 'x', at: 1 },
      'overview.disk': { status: 'ok', at: 1, data: [{ name: 'not software', version: '1' }] }
    }
    expect(softwareChips(facts)).toEqual([
      { label: 'nginx 1.24', update: false },
      { label: 'composer 2.8 ↑', update: true },
      { label: 'PHP 8.3 ↑', update: true },
      { label: 'Docker 27.3', update: false }
    ])
  })

  it('returns nothing when no software probe has data', () => {
    expect(softwareChips({})).toEqual([])
    expect(softwareChips({ 'software.installed': { status: 'ok', at: 1, data: { unknown: true } } })).toEqual([])
  })
})
