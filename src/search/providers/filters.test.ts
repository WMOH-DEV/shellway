import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useSQLStore } from '@/stores/sqlStore'
import type { SchemaColumn } from '@/types/sql'
import { useSearchIntentStore } from '../intentStore'
import { rankResults } from '../ranking'
import { useRecentFiltersStore } from '../recentFilters'
import { createFiltersProvider } from './filters'
import { createTablesProvider } from './tables'
import { collect, EMPTY_CONTEXT, makeQuery, makeSession, makeTab, resetSearchState, stubBrowser } from './testHelpers'

const column = (name: string, tableName: string): SchemaColumn => ({
  name,
  tableName,
  type: 'varchar',
  nullable: false,
  defaultValue: null,
  isPrimaryKey: false,
  isAutoIncrement: false
})

function seedLibrary(): void {
  useSessionStore.setState({ sessions: [makeSession({ id: 's1', name: 'Library server' })] })
  useConnectionStore.setState({ tabs: [makeTab({ id: 't1', sessionId: 's1', sessionName: 'Library server' })], activeTabId: 't1' })
  const sql = useSQLStore.getState()
  sql.setCurrentDatabase('t1', 'library')
  sql.setTables('t1', [
    { name: 'books', type: 'table' },
    { name: 'authors', type: 'table' }
  ])
  sql.setColumns('t1', [
    column('id', 'books'),
    column('title', 'books'),
    column('tier', 'books'),
    column('subtitle', 'books'),
    column('deleted_at', 'books'),
    column('name', 'authors')
  ])
}

const activeContext = { ...EMPTY_CONTEXT, activeTabId: 't1', activeSessionId: 's1', activeDatabase: 'library', connectedTabIds: ['t1'] }

const titles = async (text: string, context = EMPTY_CONTEXT) => (await collect(createFiltersProvider(), makeQuery(text, { context }))).map((r) => r.title)

describe('filters provider', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeText = stubBrowser().writeText
    resetSearchState()
    useRecentFiltersStore.setState({ entries: [] })
    seedLibrary()
  })

  afterEach(() => vi.unstubAllGlobals())

  it.each(['books.title', 'books@title', 'Books.Title'])('offers to filter by the column for %s', async (text) => {
    const [found] = await collect(createFiltersProvider(), makeQuery(text))
    expect(found).toMatchObject({ title: 'Filter books by title', subtitle: 'type the value in the table · library · Library server', icon: 'filter' })
    expect(found.scoreHints.exact).toBe(true)
  })

  it('lists the matching columns while the column name is unfinished', async () => {
    expect(await titles('books.ti')).toEqual(['Filter books by title', 'Filter books by tier', 'Filter books by subtitle'])
    expect(await titles('books.')).toHaveLength(5)
  })

  it('describes the filter when a value is given', async () => {
    expect(await titles('books.title red fox')).toEqual(['books where title contains red fox'])
    expect(await titles('books.id>100')).toEqual(['books where id > 100'])
    expect(await titles('books.deleted_at null')).toEqual(['books where deleted_at is null'])
  })

  it('uses the closest column when a value is given', async () => {
    expect(await titles('books.tit=x')).toEqual(['books where title = x'])
  })

  it('opens a row by key', async () => {
    expect(await titles('books:42')).toEqual(['books row 42'])
  })

  it('finds nothing for a table that is not there or a column it does not have', async () => {
    expect(await titles('movies.title')).toEqual([])
    expect(await titles('books.price=3')).toEqual([])
  })

  it('does not guess a column when none was named', async () => {
    expect(await titles('books.=5')).toEqual([])
    expect(await titles('books. dune')).toEqual([])
  })

  it('ranks the filter above the table and column it names', async () => {
    const query = makeQuery('books.title red fox')
    const all = [...(await collect(createFiltersProvider(), query)), ...(await collect(createTablesProvider(), query))]
    expect(rankResults(all, query.text)[0].title).toBe('books where title contains red fox')
  })

  it('opens the table with the filter, in a new tab on the secondary action, and copies the title', async () => {
    const provider = createFiltersProvider()
    const [found] = await collect(provider, makeQuery('books.title red fox'))
    const actions = provider.actions(found)
    actions.find((a) => a.role === 'primary')!.run()
    actions.find((a) => a.role === 'secondary')!.run()
    actions.find((a) => a.role === 'copy')!.run()
    const filter = { kind: 'filters', filters: [{ column: 'title', operator: 'contains', value: 'red fox' }] }
    expect(useSearchIntentStore.getState().pending.s1).toEqual([
      { kind: 'open-table', database: 'library', table: 'books', newTab: false, filter },
      { kind: 'open-table', database: 'library', table: 'books', newTab: true, filter }
    ])
    expect(writeText).toHaveBeenCalledWith('books where title contains red fox')
  })

  it('sends a row lookup for table:value', async () => {
    const provider = createFiltersProvider()
    const [found] = await collect(provider, makeQuery('books:42'))
    provider.actions(found).find((a) => a.role === 'primary')!.run()
    expect(useSearchIntentStore.getState().pending.s1).toEqual([
      { kind: 'open-table', database: 'library', table: 'books', newTab: false, filter: { kind: 'row', value: '42' } }
    ])
  })

  describe('recent filters', () => {
    beforeEach(() => {
      useRecentFiltersStore.setState({
        entries: [
          { scopeId: 's1', database: 'library', table: 'books', match: 'all', at: 2, filters: [{ column: 'title', operator: 'contains', value: 'dune' }, { column: 'id', operator: 'greater_than', value: '5' }] },
          { scopeId: 's1', database: 'other', table: 'books', match: 'any', at: 1, filters: [{ column: 'title', operator: 'equals', value: 'x' }] }
        ]
      })
    })

    it('shows the active database recent filters on an empty search', async () => {
      expect(await titles('', activeContext)).toEqual(['books where title contains dune and id > 5'])
      expect(await titles('')).toEqual([])
    })

    it('lists the newest recent filter first', async () => {
      useRecentFiltersStore.setState({
        entries: [
          { scopeId: 's1', database: 'library', table: 'books', match: 'any', at: Date.now() - 3_600_000, filters: [{ column: 'title', operator: 'equals', value: 'old' }] },
          { scopeId: 's1', database: 'library', table: 'authors', match: 'any', at: Date.now(), filters: [{ column: 'name', operator: 'equals', value: 'new' }] }
        ]
      })
      const found = await collect(createFiltersProvider(), makeQuery('', { context: activeContext }))
      expect(rankResults(found, '').map((r) => r.title)).toEqual(['authors where name = new', 'books where title = old'])
    })

    it('finds a recent filter by its text', async () => {
      expect(await titles('dune')).toEqual(['books where title contains dune and id > 5'])
    })

    it('replays the whole filter set with its match', async () => {
      const provider = createFiltersProvider()
      const [found] = await collect(provider, makeQuery('dune'))
      provider.actions(found).find((a) => a.role === 'primary')!.run()
      expect(useSearchIntentStore.getState().pending.s1?.[0]).toMatchObject({
        filter: { kind: 'filters', match: 'all', filters: [{ column: 'title', value: 'dune' }, { column: 'id', value: '5' }] }
      })
    })
  })
})
