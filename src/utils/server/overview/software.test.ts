import { describe, expect, it } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { softwareChips } from './software'

const packages = {
  supported: true,
  installed: [
    { name: 'nginx', version: '1.24.0-2ubuntu7', candidate: null },
    { name: 'redis-server', version: '5:7.0.15-1ubuntu0.24.04.5', candidate: '5:7.0.15-1ubuntu0.24.04.6' },
    { name: 'curl', version: '8.5.0', candidate: null }
  ],
  services: {},
  composerVersion: '2.8.1',
  certbotSnapVersion: null,
  node: { version: null, source: null, nvmVersions: [], pm2Version: null },
  siteCounts: { nginx: 1, apache: 0 },
  listening: []
}

describe('softwareChips', () => {
  it('names catalog components with short versions and marks updates', () => {
    const facts: ServerFacts = {
      'software.packages': { status: 'ok', at: 1, data: packages },
      'software.php': { status: 'ok', at: 1, data: { installed: true, cliDefault: '8.3', versions: [{ version: '8.3' }], installable: [], sites: [] } }
    }
    expect(softwareChips(facts)).toEqual([
      { label: 'nginx 1.24', update: false },
      { label: 'Redis 7.0 ↑', update: true },
      { label: 'PHP 8.3', update: false },
      { label: 'Composer 2.8', update: false }
    ])
  })

  it('returns nothing when the software probes have no data', () => {
    expect(softwareChips({})).toEqual([])
    expect(softwareChips({ 'software.packages': { status: 'error', error: 'x', at: 1 } })).toEqual([])
  })
})
