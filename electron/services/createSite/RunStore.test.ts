import { describe, expect, it, vi } from 'vitest'
import type { RunRecord } from '../../../src/types/createSite'
import { baseInput } from '../../../src/utils/createSite/testFixtures'
import { NOTHING_CREATED } from './CreateSiteRun'
import { RunStore } from './RunStore'

vi.mock('electron-store', () => ({
  default: class {
    private data: Record<string, unknown>
    constructor({ defaults }: { defaults: Record<string, unknown> }) {
      this.data = structuredClone(defaults)
    }
    get(key: string): unknown {
      return this.data[key]
    }
    set(key: string, value: unknown): void {
      this.data[key] = value
    }
  }
}))

const run = (id: string, phase: RunRecord['phase'], createdAt: number): RunRecord => ({
  id,
  sessionId: 'session-1',
  domain: 'shop.example.com',
  createdAt,
  server: { kind: 'nginx' },
  input: baseInput(),
  steps: [],
  created: NOTHING_CREATED,
  phase,
  current: null,
  error: null,
  deployKey: null
})

describe('RunStore', () => {
  it('keeps every finished site so it can still be deleted, and prunes only old removed runs', () => {
    const store = new RunStore()
    for (let i = 0; i < 60; i += 1) store.save(run(`done-${i}`, 'done', i))
    for (let i = 0; i < 60; i += 1) store.save(run(`removed-${i}`, 'removed', 100 + i))
    const ids = store.forSession('session-1').map((record) => record.id)
    expect(ids.filter((id) => id.startsWith('done-'))).toHaveLength(60)
    expect(ids.filter((id) => id.startsWith('removed-'))).toHaveLength(50)
    expect(ids).not.toContain('removed-0')
    expect(ids).toContain('removed-59')
  })
})
