import { describe, expect, it } from 'vitest'
import { changedLines, lineDiff } from './diff'

const numbered = (count: number, prefix: string): string[] => Array.from({ length: count }, (_, index) => `${prefix}${index}`)

describe('lineDiff', () => {
  it('marks an inserted line without shifting the lines after it', () => {
    expect(lineDiff(['a', 'b', 'c'], ['a', 'x', 'b', 'c']).map((line) => `${line.kind}:${line.text}`)).toEqual(['same:a', 'add:x', 'same:b', 'same:c'])
  })

  it('falls back to remove-then-add when the changed middle is too large to compare line by line', () => {
    const lines = lineDiff(['keep', ...numbered(3000, 'old')], ['keep', ...numbered(3000, 'new')])
    expect(lines).toHaveLength(6001)
    expect(lines[1]).toEqual({ kind: 'remove', oldLine: 2, newLine: null, text: 'old0' })
    expect(lines[3001]).toEqual({ kind: 'add', oldLine: null, newLine: 2, text: 'new0' })
  })
})

describe('changedLines', () => {
  it('keeps three lines of context around each change', () => {
    const before = numbered(20, 'line').join('\n')
    const after = before.replace('line10', 'LINE10')
    expect(changedLines(before, after).map((line) => line.text)).toEqual(['line7', 'line8', 'line9', 'line10', 'LINE10', 'line11', 'line12', 'line13'])
  })
})
