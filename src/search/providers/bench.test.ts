import { beforeEach, describe, expect, it } from 'vitest'
import type { CachedTable } from '@/types/search'
import { applyPatch } from '../cachePatch'
import { useSearchCacheStore } from '../cacheClient'
import { createTablesProvider } from './tables'
import { collect, makeQuery, resetSearchState, stubBrowser } from './testHelpers'

const BUDGET_MS = 50
const RUNS = 5
const COMMON_COLUMNS = ['id', 'created_at', 'updated_at', 'name', 'email', 'status', 'total', 'customer_id', 'order_id', 'price', 'quantity', 'deleted_at', 'user_id', 'title']

function seed(scopeId: string, tables: CachedTable[]): void {
  const snapshot = applyPatch(useSearchCacheStore.getState().snapshot!, { kind: 'tables', scopeId, database: 'db', tables }, 1)
  useSearchCacheStore.setState({ snapshot })
}

function realisticSchema(count: number): CachedTable[] {
  const kinds = ['orders', 'users', 'invoices', 'products', 'logs']
  return Array.from({ length: count }, (_, i) => ({ name: `t${i}_${kinds[i % kinds.length]}`, type: 'table', columns: COMMON_COLUMNS }))
}

function uniqueColumnSchema(tables: number, columnsEach: number): CachedTable[] {
  return Array.from({ length: tables }, (_, t) => ({
    name: `tbl_${t}`,
    type: 'table',
    columns: Array.from({ length: columnsEach }, (_, c) => `col_${t * columnsEach + c}`)
  }))
}

async function medianMs(text: string): Promise<number> {
  const provider = createTablesProvider()
  await collect(provider, makeQuery(text))
  const times: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now()
    await collect(provider, makeQuery(text))
    times.push(performance.now() - start)
  }
  return times.sort((a, b) => a - b)[Math.floor(RUNS / 2)]
}

describe('local search over 50k indexed entries', () => {
  beforeEach(() => {
    resetSearchState()
    stubBrowser()
  })

  it.each(['c', 'cu', 'cust', 'order', 'users email'])('answers %j within the keystroke budget on a realistic schema', async (text) => {
    seed('s1', realisticSchema(3400))
    expect(await medianMs(text)).toBeLessThan(BUDGET_MS)
  })

  it.each(['c', 'col', 'col_49'])('answers %j within the keystroke budget when every column name is unique', async (text) => {
    seed('s1', uniqueColumnSchema(200, 250))
    expect(await medianMs(text)).toBeLessThan(BUDGET_MS)
  })
})
