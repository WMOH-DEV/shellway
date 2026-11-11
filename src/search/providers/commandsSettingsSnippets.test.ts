import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSnippetStore } from '@/stores/snippetStore'
import { useUIStore } from '@/stores/uiStore'
import type { Snippet } from '@/types/snippet'
import { formatCombo } from '@/utils/keybindings'
import { applyPatch } from '../cachePatch'
import { useSearchCacheStore } from '../cacheClient'
import { useSearchIntentStore } from '../intentStore'
import { SETTINGS_ENTRIES } from '../registries/settingsEntries'
import { createCommandsProvider } from './commands'
import { createSettingsProvider } from './settings'
import { createSnippetsProvider } from './snippets'
import { collect, EMPTY_CONTEXT, makeQuery, makeTab, resetSearchState, stubBrowser } from './testHelpers'

const snippet = (overrides: Partial<Snippet>): Snippet => ({
  id: 'sn1',
  name: 'Restart nginx',
  command: 'sudo systemctl restart nginx',
  category: 'Web',
  shortcut: 'rn',
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

describe('commands provider', () => {
  beforeEach(() => {
    stubBrowser({ settings: { update: vi.fn().mockResolvedValue(undefined) } })
    resetSearchState()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('lists keybinding actions with scope and combo, but not search itself', async () => {
    const provider = createCommandsProvider()
    const [newWindow] = await collect(provider, makeQuery('new window'))
    expect(newWindow).toMatchObject({ id: 'command:key:global:newWindow', icon: 'command', hint: '>' })
    expect(newWindow.subtitle).toBe(`Global · ${formatCombo('CmdOrCtrl+Alt+N')}`)
    expect(await collect(provider, makeQuery('search everything'))).toEqual([])
  })

  it('opens settings sections', async () => {
    const provider = createCommandsProvider()
    const results = await collect(provider, makeQuery('settings appearance'))
    const section = results.find((r) => r.title === 'Settings › Appearance')!
    provider.actions(section)[0].run()
    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsSection).toBe('appearance')
  })

  it('toggles the theme', async () => {
    useUIStore.getState().setTheme('dark')
    vi.stubGlobal('document', { documentElement: { classList: { add: vi.fn(), remove: vi.fn() } } })
    const provider = createCommandsProvider()
    const [toggle] = await collect(provider, makeQuery('toggle theme'))
    provider.actions(toggle)[0].run()
    expect(useUIStore.getState().resolvedTheme).toBe('light')
  })

  it('dispatches SQL shortcuts on the document body so editor focus checks do not swallow them', async () => {
    const dispatched: KeyboardEvent[] = []
    class FakeKeyboardEvent {
      constructor(
        public type: string,
        public init: Record<string, unknown>
      ) {}
    }
    vi.stubGlobal('KeyboardEvent', FakeKeyboardEvent)
    vi.stubGlobal('document', { body: { dispatchEvent: (e: KeyboardEvent) => dispatched.push(e) }, activeElement: { dispatchEvent: () => {} } })
    const provider = createCommandsProvider()
    const [keyed] = await collect(provider, makeQuery('toggle sql sidebar'))
    provider.actions(keyed)[0].run()
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]).toMatchObject({ type: 'keydown', init: { key: 'b', ctrlKey: true, bubbles: true } })
  })

  it('adds database commands with a context boost only when a database is active', async () => {
    const provider = createCommandsProvider()
    expect(await collect(provider, makeQuery('export database'))).toEqual([])
    const context = { ...EMPTY_CONTEXT, activeSessionId: 's1', activeDatabase: 'shop' }
    const [exportDb] = await collect(provider, makeQuery('export database', { context }))
    expect(exportDb.title).toBe('Export database shop…')
    expect(exportDb.scoreHints.context).toBe(1)
    useConnectionStore.setState({ tabs: [makeTab({ activeSubTab: 'sql' })] })
    provider.actions(exportDb)[0].run()
    expect(useSearchIntentStore.getState().pending.s1).toEqual([{ kind: 'sql-action', action: 'export' }])
  })

  it('suggests only commands that were used before on an empty query', async () => {
    const provider = createCommandsProvider()
    expect(await collect(provider, makeQuery(''))).toEqual([])
    const base = useSearchCacheStore.getState().snapshot!
    useSearchCacheStore.setState({
      snapshot: applyPatch(applyPatch(base, { kind: 'usage', resultId: 'command:app:new-session', queryText: '' }, 5), { kind: 'usage', resultId: 'command:app:host-keys', queryText: '' }, 9)
    })
    expect((await collect(provider, makeQuery(''))).map((r) => r.id)).toEqual(['command:app:host-keys', 'command:app:new-session'])
  })
})

describe('settings provider', () => {
  beforeEach(() => {
    stubBrowser()
    resetSearchState()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('has an entry per section and at least 25 notable settings', () => {
    expect(SETTINGS_ENTRIES.filter((e) => e.id.startsWith('section-'))).toHaveLength(9)
    expect(SETTINGS_ENTRIES.filter((e) => !e.id.startsWith('section-')).length).toBeGreaterThanOrEqual(25)
  })

  it('finds a setting by label or keyword and opens its section', async () => {
    const provider = createSettingsProvider()
    const [bell] = await collect(provider, makeQuery('terminal bell'))
    expect(bell).toMatchObject({ id: 'setting:terminal-bell', subtitle: 'Settings › Terminal', icon: 'setting' })
    provider.actions(bell)[0].run()
    expect(useUIStore.getState().settingsSection).toBe('terminal')
    expect((await collect(provider, makeQuery('beep'))).map((r) => r.id)).toContain('setting:terminal-bell')
    expect(await collect(provider, makeQuery(''))).toEqual([])
  })
})

describe('snippets provider', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeText = stubBrowser().writeText
    resetSearchState()
    useSnippetStore.setState({ snippets: [snippet({})] })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('matches name, shortcut and category but never the command text', async () => {
    const provider = createSnippetsProvider()
    expect(await collect(provider, makeQuery('restart'))).toHaveLength(1)
    expect(await collect(provider, makeQuery('rn'))).toHaveLength(1)
    expect(await collect(provider, makeQuery('web'))).toHaveLength(1)
    expect(await collect(provider, makeQuery('systemctl'))).toEqual([])
  })

  it('offers terminal insert only when an SSH tab is active', async () => {
    const provider = createSnippetsProvider()
    const [result] = await collect(provider, makeQuery('restart'))
    expect(provider.actions(result).map((a) => a.id)).toEqual(['copy'])

    useConnectionStore.setState({ tabs: [makeTab()], activeTabId: 't1' })
    const actions = provider.actions(result)
    expect(actions.map((a) => a.id)).toEqual(['insert', 'copy'])
    actions[0].run()
    actions[1].run()
    expect(useSearchIntentStore.getState().pending.s1).toEqual([{ kind: 'terminal-insert', text: 'sudo systemctl restart nginx' }])
    expect(writeText).toHaveBeenCalledWith('sudo systemctl restart nginx')
  })
})
