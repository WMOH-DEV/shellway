import { describe, expect, it } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { dockerAttention } from './attention'
import { parseContainers } from './containers'
import { isCrashed } from './exposure'
import { CONTAINERS } from './fixtures/output'
import { groupStacks, linkedSite, portViews } from './stacks'
import type { DockerContainer } from './types'

const containers = parseContainers(CONTAINERS).items
const facts: ServerFacts = { 'docker.containers': { status: 'ok', data: { items: containers, truncated: false }, at: 0 } }
const byName = (name: string): DockerContainer => containers.find((container) => container.name === name)!

describe('dockerAttention', () => {
  it('ranks a crashed container above public ports', () => {
    const items = dockerAttention(facts)
    expect(items.map((item) => [item.id, item.level, item.rank])).toEqual([
      ['docker.crashed.worker', 'error', 140],
      ['docker.public-ports', 'warning', 80]
    ])
    expect(items[0].route).toEqual({ section: 'docker', params: { container: 'worker' } })
    expect(items[1].detail).toBe('Docker skips the ufw firewall for published ports: web (0.0.0.0:8080 → 80).')
  })

  it('returns nothing without container facts', () => {
    expect(dockerAttention({})).toEqual([])
  })
})

describe('isCrashed', () => {
  const worker = byName('worker')

  it.each([
    [{}, true],
    [{ restartPolicy: 'no' }, false],
    [{ restartPolicy: 'on-failure' }, false],
    [{ exitCode: 0 }, false],
    [{ exitCode: 143 }, false],
    [{ exitCode: 137 }, false],
    [{ exitCode: 137, oomKilled: true }, true],
    [{ status: 'running' }, false]
  ])('%j -> %s', (override, expected) => {
    expect(isCrashed({ ...worker, ...override })).toBe(expected)
  })
})

describe('stacks', () => {
  it('groups compose projects first and standalone containers last', () => {
    const stacks = groupStacks(containers)
    expect(stacks.map((stack) => [stack.project, stack.containers.map((container) => container.name)])).toEqual([
      ['status', ['status-app', 'status-db']],
      [null, ['web', 'worker']]
    ])
    expect(stacks[0].configFile).toBe('/srv/status/compose.yml')
  })

  it('links a stack to a site whose folder contains it or sits inside it', () => {
    const [status] = groupStacks(containers)
    expect(linkedSite(status, [{ name: 'other', path: '/srv/statuspage' }, { name: 'status.example.com', path: '/srv/status/' }])?.name).toBe('status.example.com')
    expect(linkedSite(status, [{ name: 'root', path: '/srv' }])?.name).toBe('root')
    expect(linkedSite(status, [{ name: 'app', path: '/var/www/app' }])).toBeNull()
  })

  it('collapses IPv4 and IPv6 bindings into one port', () => {
    expect(portViews(byName('web'))).toEqual([{ text: '0.0.0.0:8080', isPublic: true }])
    expect(portViews(byName('status-app'))).toEqual([{ text: '127.0.0.1:3001', isPublic: false }])
    expect(portViews(byName('status-db'))).toEqual([])
  })
})
