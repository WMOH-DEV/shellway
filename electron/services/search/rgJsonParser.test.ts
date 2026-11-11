import { describe, expect, it } from 'vitest'
import {
  createLineSplitter,
  makeMatcher,
  parseEngineMarker,
  parseFileLines,
  parseGrepLine,
  parseRgJsonLine
} from './rgJsonParser'

const ROOT = '/var/www/shop'

const matchLine = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'match',
    data: {
      path: { text: './app/Orders.php' },
      lines: { text: "class OrderRefunded extends Event\n" },
      line_number: 12,
      absolute_offset: 0,
      submatches: [{ match: { text: 'OrderRefunded' }, start: 6, end: 19 }],
      ...overrides
    }
  })

describe('parseRgJsonLine', () => {
  it('returns an absolute path, the line number, the text and the ranges', () => {
    expect(parseRgJsonLine(matchLine(), ROOT)).toEqual({
      path: '/var/www/shop/app/Orders.php',
      line: 12,
      text: 'class OrderRefunded extends Event',
      ranges: [[6, 19]]
    })
  })

  it.each(['begin', 'end', 'summary', 'context'])('ignores %s events', (type) => {
    expect(parseRgJsonLine(JSON.stringify({ type, data: {} }), ROOT)).toBeNull()
  })

  it('ignores lines that are not JSON', () => {
    expect(parseRgJsonLine('not json', ROOT)).toBeNull()
  })

  it('skips paths that are not valid text', () => {
    expect(parseRgJsonLine(matchLine({ path: { bytes: 'Li9hLnBocA==' } }), ROOT)).toBeNull()
  })

  it('converts UTF-8 byte offsets into string indices', () => {
    const line = matchLine({
      lines: { text: 'café OrderRefunded\n' },
      submatches: [{ match: { text: 'OrderRefunded' }, start: 6, end: 19 }]
    })
    expect(parseRgJsonLine(line, ROOT)?.ranges).toEqual([[5, 18]])
  })

  it('truncates long lines and drops ranges past the limit', () => {
    const long = `${'a'.repeat(450)}\n`
    const line = matchLine({
      lines: { text: long },
      submatches: [
        { match: { text: 'a' }, start: 10, end: 11 },
        { match: { text: 'a' }, start: 395, end: 420 },
        { match: { text: 'a' }, start: 430, end: 440 }
      ]
    })
    const match = parseRgJsonLine(line, ROOT)
    expect(match?.text).toHaveLength(400)
    expect(match?.ranges).toEqual([
      [10, 11],
      [395, 400]
    ])
  })

  it('handles a huge minified line with thousands of submatches quickly', () => {
    const text = 'ab '.repeat(200_000)
    const submatches = Array.from({ length: 100_000 }, (_, i) => ({ match: { text: 'ab' }, start: i * 3, end: i * 3 + 2 }))
    const started = performance.now()
    const parsed = parseRgJsonLine(matchLine({ lines: { text }, submatches }), ROOT)!
    expect(performance.now() - started).toBeLessThan(250)
    expect(parsed.text.length).toBe(400)
    expect(parsed.ranges.length).toBeLessThanOrEqual(50)
    expect(parsed.ranges[1]).toEqual([3, 5])
  })

  it('keeps a CRLF line free of the carriage return', () => {
    expect(parseRgJsonLine(matchLine({ lines: { text: 'x OrderRefunded\r\n' } }), ROOT)?.text).toBe('x OrderRefunded')
  })
})

describe('createLineSplitter', () => {
  it('joins a line split across two chunks', () => {
    const splitter = createLineSplitter()
    expect(splitter.push('first\nsec')).toEqual(['first'])
    expect(splitter.push('ond\nthird')).toEqual(['second'])
    expect(splitter.flush()).toEqual(['third'])
    expect(splitter.flush()).toEqual([])
  })

  it('splits a JSON match line delivered in two pushes', () => {
    const splitter = createLineSplitter()
    const full = `${matchLine()}\n`
    const lines = [...splitter.push(full.slice(0, 40)), ...splitter.push(full.slice(40))]
    expect(lines).toHaveLength(1)
    expect(parseRgJsonLine(lines[0], ROOT)?.line).toBe(12)
  })

  it('drops the whole of an oversize line instead of emitting its tail', () => {
    const splitter = createLineSplitter()
    expect(splitter.push('x'.repeat(1024 * 1024 + 1))).toEqual([])
    expect(splitter.push('./tail.php:3:not a real match\nnext\n')).toEqual(['next'])
  })

  it('strips carriage returns', () => {
    expect(createLineSplitter().push('a\r\nb\r\n')).toEqual(['a', 'b'])
  })
})

describe('parseEngineMarker', () => {
  it('reads the engine marker and ignores other lines', () => {
    expect(parseEngineMarker('@@engine rg')).toBe('rg')
    expect(parseEngineMarker('@@engine grep')).toBe('grep')
    expect(parseEngineMarker('@@engine awk')).toBeNull()
    expect(parseEngineMarker('./a.php:1:x')).toBeNull()
  })
})

describe('makeMatcher', () => {
  const options = { caseSensitive: false, wholeWord: false, regex: false }

  it('finds every occurrence ignoring case', () => {
    expect(makeMatcher('order', options)('Order and ORDER')).toEqual([
      [0, 5],
      [10, 15]
    ])
  })

  it('respects case when asked to', () => {
    expect(makeMatcher('order', { ...options, caseSensitive: true })('Order order')).toEqual([[6, 11]])
  })

  it('escapes regex characters when not in regex mode', () => {
    expect(makeMatcher('a.c', options)('abc a.c')).toEqual([[4, 7]])
  })

  it('matches whole words only', () => {
    expect(makeMatcher('order', { ...options, wholeWord: true })('reorder order orders')).toEqual([[8, 13]])
  })

  it('treats the text as a regex in regex mode', () => {
    expect(makeMatcher('o\\w+r', { ...options, regex: true })('order')).toEqual([[0, 5]])
  })

  it('returns no ranges for an invalid regex', () => {
    expect(makeMatcher('(', { ...options, regex: true })('(')).toEqual([])
  })

  it('does not loop on a pattern that matches the empty string', () => {
    expect(makeMatcher('x*', { ...options, regex: true })('abc')).toEqual([])
  })
})

describe('parseGrepLine', () => {
  const matcher = makeMatcher('Order', { caseSensitive: true, wholeWord: false, regex: false })

  it('parses ./path:line:text with ranges from the matcher', () => {
    expect(parseGrepLine('./app/Orders.php:12:class Order {', ROOT, matcher)).toEqual({
      path: '/var/www/shop/app/Orders.php',
      line: 12,
      text: 'class Order {',
      ranges: [[6, 11]]
    })
  })

  it('keeps colons that belong to the matched text', () => {
    expect(parseGrepLine('./a.php:3:Order::find(1)', ROOT, matcher)?.text).toBe('Order::find(1)')
  })

  it('returns null for lines that are not matches', () => {
    expect(parseGrepLine('Binary file ./x matches', ROOT, matcher)).toBeNull()
  })
})

describe('parseFileLines', () => {
  it('makes paths absolute and drops blanks', () => {
    expect(parseFileLines(['./app/Orders.php', '', './README.md'], ROOT)).toEqual([
      '/var/www/shop/app/Orders.php',
      '/var/www/shop/README.md'
    ])
  })
})
