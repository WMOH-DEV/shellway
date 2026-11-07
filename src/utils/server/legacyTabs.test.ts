import { describe, expect, it } from 'vitest'
import type { ConnectionTab } from '@/types/session'
import { CLASSIC_SUB_TABS, isClassicSubTab, normalizeSubTab, normalizeSubTabList, normalizeTab } from './legacyTabs'

const tab = (overrides: Partial<ConnectionTab> = {}): ConnectionTab => ({
  id: 'tab-1',
  sessionId: 'session-1',
  sessionName: 'Example',
  status: 'connected',
  activeSubTab: 'terminal',
  ...overrides
})

describe('normalizeSubTab', () => {
  it.each([
    ['deploy', { section: 'sites' }],
    ['ssl', { section: 'sites', sub: 'https' }],
    ['services', { section: 'services' }],
    ['monitor', { section: 'overview', sub: 'metrics' }],
    ['info', { section: 'overview' }]
  ] as const)('maps classic %s to the Server tab when classic tabs are off', (id, route) => {
    expect(normalizeSubTab(id, false)).toEqual({ subTab: 'server', route })
  })

  it('keeps classic ids when classic tabs are on', () => {
    expect(normalizeSubTab('deploy', true)).toEqual({ subTab: 'deploy' })
  })

  it.each(['server', 'terminal', 'sftp', 'sql', 'port-forwarding', 'log'] as const)('keeps %s as is', (id) => {
    expect(normalizeSubTab(id, false)).toEqual({ subTab: id })
  })

  it('returns a fresh route object each time', () => {
    const first = normalizeSubTab('ssl', false).route
    first!.sub = 'changed'
    expect(normalizeSubTab('ssl', false).route).toEqual({ section: 'sites', sub: 'https' })
  })
})

describe('isClassicSubTab', () => {
  it('knows exactly the five classic tabs', () => {
    expect([...CLASSIC_SUB_TABS].sort()).toEqual(['deploy', 'info', 'monitor', 'services', 'ssl'])
    expect(isClassicSubTab('toString')).toBe(false)
    expect(isClassicSubTab('server')).toBe(false)
  })
})

describe('normalizeSubTabList', () => {
  it('folds every classic id into one server entry', () => {
    expect(normalizeSubTabList(['terminal', 'deploy', 'ssl', 'monitor', 'sftp'], false)).toEqual(['terminal', 'server', 'sftp'])
  })

  it('leaves the list alone when classic tabs are on', () => {
    expect(normalizeSubTabList(['terminal', 'deploy'], true)).toEqual(['terminal', 'deploy'])
  })
})

describe('normalizeTab', () => {
  it('moves the active classic tab and running list to the Server tab', () => {
    const result = normalizeTab(tab({ activeSubTab: 'ssl', runningSubTabs: ['ssl'], detachedSubTabs: ['deploy'] }), false)
    expect(result.route).toEqual({ section: 'sites', sub: 'https' })
    expect(result.tab).toMatchObject({ activeSubTab: 'server', runningSubTabs: ['server'], detachedSubTabs: ['deploy'] })
  })

  it('keeps an undefined running list undefined', () => {
    expect(normalizeTab(tab(), false)).toEqual({ tab: tab({ runningSubTabs: undefined }), route: undefined })
  })
})
