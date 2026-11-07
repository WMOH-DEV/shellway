import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSQLStore } from '@/stores/sqlStore'
import { openInSqlTab } from './openInSql'

const toastMock = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }))
vi.mock('@/components/ui/Toast', () => ({ toast: toastMock }))

const TAB = 'tab-1'
const switchDatabase = vi.fn()

function finishConnecting(type: 'mysql' | 'postgres', sessionId = 'sql-1'): void {
  const store = useSQLStore.getState()
  store.setConnectionStatus(TAB, 'connected')
  store.setConnectionConfig(TAB, { type } as never)
  store.setSqlSessionId(TAB, sessionId)
}

function dropConnection(): void {
  useSQLStore.getState().setConnectionStatus(TAB, 'error')
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  vi.clearAllMocks()
  useSQLStore.setState({ connections: {}, pendingDatabases: {} })
  switchDatabase.mockResolvedValue({ success: true })
  ;(globalThis as any).window = { novadeck: { sql: { switchDatabase } } }
})

describe('openInSqlTab', () => {
  it('stores a pending database when the SQL tab is not connected', async () => {
    await openInSqlTab(TAB, 'mysql', 'shop_prod')

    expect(useSQLStore.getState().pendingDatabases[TAB]).toMatchObject({ engine: 'mysql', database: 'shop_prod', staleSessionId: null })
    expect(toastMock.info).toHaveBeenCalledWith('Connect to the database server, then Shellway opens shop_prod.')
    expect(switchDatabase).not.toHaveBeenCalled()
  })

  it('switches immediately when already connected to the same engine', async () => {
    finishConnecting('mysql')

    await openInSqlTab(TAB, 'mysql', 'shop_prod')

    expect(switchDatabase).toHaveBeenCalledWith('sql-1', 'shop_prod')
    expect(useSQLStore.getState().connections[TAB].currentDatabase).toBe('shop_prod')
    expect(useSQLStore.getState().pendingDatabases[TAB]).toBeUndefined()
  })

  it('does not store a pending database when connected to a different engine', async () => {
    finishConnecting('postgres')

    await openInSqlTab(TAB, 'mysql', 'shop_prod')

    expect(useSQLStore.getState().pendingDatabases[TAB]).toBeUndefined()
    expect(toastMock.info).toHaveBeenCalledWith('Pick shop_prod in the SQL tab', 'The SQL tab is connected to a different kind of database.')
  })
})

describe('pending database on connect', () => {
  it('switches to the pending database and clears it once connected', async () => {
    await openInSqlTab(TAB, 'mysql', 'shop_prod')

    finishConnecting('mysql')
    await flush()

    expect(switchDatabase).toHaveBeenCalledWith('sql-1', 'shop_prod')
    expect(useSQLStore.getState().connections[TAB].currentDatabase).toBe('shop_prod')
    expect(useSQLStore.getState().pendingDatabases[TAB]).toBeUndefined()
  })

  it('does not switch and clears the pending entry when the engine differs', async () => {
    await openInSqlTab(TAB, 'mysql', 'shop_prod')

    finishConnecting('postgres')
    await flush()

    expect(switchDatabase).not.toHaveBeenCalled()
    expect(useSQLStore.getState().pendingDatabases[TAB]).toBeUndefined()
  })

  it('shows an error toast and clears the pending entry when the switch fails', async () => {
    switchDatabase.mockResolvedValue({ success: false })
    await openInSqlTab(TAB, 'mysql', 'shop_prod')

    finishConnecting('mysql')
    await flush()

    expect(toastMock.error).toHaveBeenCalledWith('Could not open shop_prod', 'Pick it in the SQL tab.')
    expect(useSQLStore.getState().pendingDatabases[TAB]).toBeUndefined()
  })

  it('waits for the new session after a dropped connection instead of using the old one', async () => {
    finishConnecting('postgres', 'sql-old')
    dropConnection()
    await openInSqlTab(TAB, 'mysql', 'shop_prod')

    finishConnecting('mysql', 'sql-new')
    await flush()

    expect(switchDatabase).toHaveBeenCalledTimes(1)
    expect(switchDatabase).toHaveBeenCalledWith('sql-new', 'shop_prod')
    expect(toastMock.info).not.toHaveBeenCalledWith('Pick shop_prod in the SQL tab', expect.anything())
  })

  it('drops a pending database that waited too long, without switching', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await openInSqlTab(TAB, 'mysql', 'shop_prod')
      vi.setSystemTime(Date.now() + 11 * 60 * 1000)

      finishConnecting('mysql')
      await flush()

      expect(switchDatabase).not.toHaveBeenCalled()
      expect(useSQLStore.getState().pendingDatabases[TAB]).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('forgets the pending database when the SQL tab is reset or closed', async () => {
    await openInSqlTab(TAB, 'mysql', 'shop_prod')
    useSQLStore.getState().reset(TAB)
    expect(useSQLStore.getState().pendingDatabases[TAB]).toBeUndefined()

    await openInSqlTab(TAB, 'mysql', 'shop_prod')
    useSQLStore.getState().removeConnection(TAB)
    expect(useSQLStore.getState().pendingDatabases[TAB]).toBeUndefined()
  })
})
