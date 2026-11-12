import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSearchIntentStore } from '@/search/intentStore'
import { useSQLStore } from '@/stores/sqlStore'
import { useSqlSearchIntents } from './useSqlSearchIntents'

const SESSION = 'session-1'
const CONNECTION = 'tab-1'

function setup(overrides: Partial<Parameters<typeof useSqlSearchIntents>[0]> = {}) {
  const handlers = {
    switchDatabase: vi.fn(async (database: string) => {
      useSQLStore.getState().setCurrentDatabase(CONNECTION, database)
    }),
    openTable: vi.fn(),
    openQuery: vi.fn(),
    newQuery: vi.fn(),
    refresh: vi.fn(),
    databaseAction: vi.fn(),
    connect: vi.fn()
  }
  const view = renderHook(
    (props: { ready: boolean; currentDatabase: string | null; canConnect: boolean }) =>
      useSqlSearchIntents({ sessionId: SESSION, connectionId: CONNECTION, ...props, ...handlers, ...overrides }),
    { initialProps: { ready: true, currentDatabase: 'shop' as string | null, canConnect: false } }
  )
  return { handlers, view }
}

beforeEach(() => {
  useSearchIntentStore.setState({ pending: {} })
  useSQLStore.getState().setCurrentDatabase(CONNECTION, 'shop')
})

describe('useSqlSearchIntents', () => {
  it('opens a table of the current database once', async () => {
    const { handlers } = setup()

    act(() => useSearchIntentStore.getState().push(SESSION, { kind: 'open-table', database: 'shop', table: 'orders', newTab: false }))

    await waitFor(() => expect(handlers.openTable).toHaveBeenCalledWith('orders', false))
    expect(handlers.openTable).toHaveBeenCalledTimes(1)
    expect(handlers.switchDatabase).not.toHaveBeenCalled()
    expect(useSearchIntentStore.getState().pending[SESSION]).toEqual([])
  })

  it('waits until the connection is ready and keeps the intent meanwhile', async () => {
    const { handlers, view } = setup()
    view.rerender({ ready: false, currentDatabase: 'shop', canConnect: false })

    act(() => useSearchIntentStore.getState().push(SESSION, { kind: 'open-table', database: 'shop', table: 'orders', newTab: true }))
    expect(handlers.openTable).not.toHaveBeenCalled()
    expect(useSearchIntentStore.getState().pending[SESSION]).toHaveLength(1)

    view.rerender({ ready: true, currentDatabase: 'shop', canConnect: false })

    await waitFor(() => expect(handlers.openTable).toHaveBeenCalledWith('orders', true))
    expect(handlers.openTable).toHaveBeenCalledTimes(1)
  })

  it('switches database first and opens the table after the switch is visible', async () => {
    const { handlers, view } = setup()

    act(() => useSearchIntentStore.getState().push(SESSION, { kind: 'open-table', database: 'staging', table: 'orders', newTab: false }))

    await waitFor(() => expect(handlers.switchDatabase).toHaveBeenCalledWith('staging'))
    expect(handlers.openTable).not.toHaveBeenCalled()

    view.rerender({ ready: true, currentDatabase: 'staging', canConnect: false })

    await waitFor(() => expect(handlers.openTable).toHaveBeenCalledWith('orders', false))
    expect(handlers.switchDatabase).toHaveBeenCalledTimes(1)
  })

  it('drops an intent whose database switch failed', async () => {
    const { handlers } = setup({ switchDatabase: vi.fn(async () => undefined) })

    act(() => useSearchIntentStore.getState().push(SESSION, { kind: 'open-table', database: 'gone', table: 'orders', newTab: false }))

    await waitFor(() => expect(useSearchIntentStore.getState().pending[SESSION]).toEqual([]))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(handlers.openTable).not.toHaveBeenCalled()
  })

  it('opens saved sql in a new query tab', async () => {
    const { handlers } = setup()

    act(() => useSearchIntentStore.getState().push(SESSION, { kind: 'open-sql', sql: 'SELECT 1', title: 'Orders per day' }))

    await waitFor(() => expect(handlers.openQuery).toHaveBeenCalledWith('SELECT 1', 'Orders per day'))
  })

  it('maps database actions to the same handlers as the database menu', async () => {
    const { handlers } = setup()

    act(() => {
      const { push } = useSearchIntentStore.getState()
      push(SESSION, { kind: 'sql-action', action: 'export' })
      push(SESSION, { kind: 'sql-action', action: 'backup' })
      push(SESSION, { kind: 'sql-action', action: 'refresh' })
      push(SESSION, { kind: 'sql-action', action: 'new-query' })
    })

    await waitFor(() => expect(handlers.newQuery).toHaveBeenCalledTimes(1))
    expect(handlers.databaseAction.mock.calls).toEqual([[{ type: 'export-database' }], [{ type: 'backup' }]])
    expect(handlers.refresh).toHaveBeenCalledTimes(1)
  })

  it('leaves intents for other kinds and other sessions alone', async () => {
    const { handlers } = setup()

    act(() => {
      const { push } = useSearchIntentStore.getState()
      push(SESSION, { kind: 'sftp-reveal', path: '/var/www/shop/index.php' })
      push('other', { kind: 'open-sql', sql: 'SELECT 1', title: 't' })
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(handlers.openQuery).not.toHaveBeenCalled()
    expect(useSearchIntentStore.getState().pending[SESSION]).toHaveLength(1)
    expect(useSearchIntentStore.getState().pending.other).toHaveLength(1)
  })

  it('connects once when search asks and the saved connection is ready', async () => {
    const { handlers, view } = setup()
    view.rerender({ ready: false, currentDatabase: 'shop', canConnect: false })

    act(() => useSearchIntentStore.getState().push(SESSION, { kind: 'sql-connect' }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(handlers.connect).not.toHaveBeenCalled()

    view.rerender({ ready: false, currentDatabase: 'shop', canConnect: true })
    await waitFor(() => expect(handlers.connect).toHaveBeenCalledTimes(1))
    expect(useSearchIntentStore.getState().pending[SESSION]).toEqual([])

    view.rerender({ ready: false, currentDatabase: 'shop', canConnect: false })
    view.rerender({ ready: false, currentDatabase: 'shop', canConnect: true })
    expect(handlers.connect).toHaveBeenCalledTimes(1)
  })

  it('drops a connect request when the connection is already open', async () => {
    const { handlers } = setup()

    act(() => useSearchIntentStore.getState().push(SESSION, { kind: 'sql-connect' }))

    await waitFor(() => expect(useSearchIntentStore.getState().pending[SESSION]).toEqual([]))
    expect(handlers.connect).not.toHaveBeenCalled()
  })
})
