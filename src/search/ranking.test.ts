import { describe, expect, it } from 'vitest'
import {
  BEST_MATCH_MARGIN,
  MATCH,
  frequencyFromCount,
  groupResults,
  pickBestMatch,
  rankResults,
  recencyFromTimestamp,
  scoreResult,
  textMatch,
  type UsageLookup
} from './ranking'
import type { ProviderId, ScoredResult, SearchResult } from './types'

function result(id: string, title: string, providerId: ProviderId = 'tables', extra: Partial<SearchResult> = {}): SearchResult {
  return { id, providerId, title, subtitle: '', icon: 'table', scoreHints: {}, payload: null, ...extra }
}

describe('textMatch', () => {
  it.each([
    ['orders', 'orders', MATCH.exact],
    ['Orders', 'ord', MATCH.prefix],
    ['order_items', 'items', MATCH.wordStart],
    ['SendRefundEmail.php', 'refund', MATCH.wordStart],
    ['customer_orders_v2', 'tomer', MATCH.substring],
    ['ord_itm', 'oi', MATCH.fuzzy],
    ['payments', 'xyz', MATCH.none]
  ])('%s vs %s', (title, q, expected) => {
    expect(textMatch(title, q)).toBe(expected)
  })

  it('falls back to keywords', () => {
    expect(textMatch('Toggle theme', 'dark mode', 'appearance dark mode')).toBe(MATCH.keyword)
  })

  it('gives every result the same neutral score for an empty query', () => {
    expect(textMatch('anything', '  ')).toBe(textMatch('else', ''))
  })
})

describe('scoreResult', () => {
  it('keeps provider matches on other fields at the lowest text tier', () => {
    const indexed = scoreResult(result('a', 'Main server'), 'shop.example.com')
    expect(indexed).toBeCloseTo(MATCH.indexed)
    expect(indexed).toBeLessThan(scoreResult(result('b', 'shop.example.com'), 'shop.example.com'))
  })

  it('never drops a disconnected provider match', () => {
    const ranked = rankResults([result('a', 'Main', 'sessions', { scoreHints: { disconnected: true } })], 'clients')
    expect(ranked).toHaveLength(1)
  })

  it('weights tables above settings for the same match', () => {
    expect(scoreResult(result('a', 'orders', 'tables'), 'ord')).toBeGreaterThan(scoreResult(result('b', 'orders', 'settings'), 'ord'))
  })

  it('adds recency, frequency, context and learning', () => {
    const base = scoreResult(result('a', 'orders'), 'ord')
    const usage: UsageLookup = { recency: () => 1, frequency: () => 1, learned: () => 1 }
    const boosted = scoreResult(result('a', 'orders', 'tables', { scoreHints: { context: 1 } }), 'ord', usage)
    expect(boosted).toBeCloseTo(base + 0.25 + 0.15 + 0.2 + 0.3)
  })

  it('applies a per-result weight so columns rank below tables', () => {
    const table = scoreResult(result('t', 'customers'), 'cust')
    const column = scoreResult(result('c', 'customer_id', 'tables', { scoreHints: { weight: 0.75 } }), 'cust')
    expect(table).toBeGreaterThan(column)
  })

  it('penalises disconnected servers', () => {
    const connected = scoreResult(result('a', 'orders'), 'orders')
    const disconnected = scoreResult(result('a', 'orders', 'tables', { scoreHints: { disconnected: true } }), 'orders')
    expect(disconnected).toBeLessThan(connected)
  })
})

describe('rankResults', () => {
  it('orders exact before prefix before substring', () => {
    const ranked = rankResults([result('1', 'big_orders'), result('2', 'orders_archive'), result('3', 'orders')], 'orders')
    expect(ranked.map((r) => r.id)).toEqual(['3', '2', '1'])
  })

  it('lets a strong recency boost reorder close matches', () => {
    const usage: UsageLookup = { recency: (id) => (id === '2' ? 1 : 0), frequency: () => 0, learned: () => 0 }
    const ranked = rankResults([result('1', 'orders_a'), result('2', 'orders_b')], 'orders', usage)
    expect(ranked[0].id).toBe('2')
  })
})

describe('pickBestMatch', () => {
  const scored = (id: string, score: number): ScoredResult => ({ ...result(id, id), score })

  it('returns the top result when it beats the next by the margin', () => {
    expect(pickBestMatch([scored('a', 1), scored('b', 1 - BEST_MATCH_MARGIN * 1.5)])?.id).toBe('a')
  })

  it('returns null when the top two are close', () => {
    expect(pickBestMatch([scored('a', 1), scored('b', 0.95)])).toBeNull()
  })

  it('returns the only result', () => {
    expect(pickBestMatch([scored('a', 0.2)])?.id).toBe('a')
  })
})

describe('groupResults', () => {
  it('pulls the best match out and caps groups with overflow', () => {
    const ranked = rankResults(
      [result('t1', 'orders'), result('t2', 'orders_x'), result('t3', 'orders_y'), result('t4', 'orders_z'), result('q1', 'orders per day', 'queries')],
      'orders'
    )
    const grouped = groupResults(ranked, 2)
    expect(grouped.best?.id).toBe('t1')
    const tables = grouped.groups.find((g) => g.providerId === 'tables')!
    expect(tables.results).toHaveLength(2)
    expect(tables.overflow).toBe(1)
    expect(grouped.total).toBe(5)
  })
})

describe('recency and frequency', () => {
  it('decays recency with age', () => {
    const now = Date.now()
    expect(recencyFromTimestamp(now, now)).toBe(1)
    expect(recencyFromTimestamp(now - 24 * 3_600_000, now)).toBeCloseTo(0.5)
    expect(recencyFromTimestamp(undefined, now)).toBe(0)
  })

  it('caps frequency at 1', () => {
    expect(frequencyFromCount(0)).toBe(0)
    expect(frequencyFromCount(1000)).toBe(1)
  })
})
