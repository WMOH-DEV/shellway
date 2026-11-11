import { describe, expect, it } from 'vitest'
import type { TextMatch } from '@/types/search'
import { countFiles, defaultSearchRoot, formatCount, groupMatchesByFile, splitByRanges } from './textSearchModel'

function match(path: string, line: number, text = 'x'): TextMatch {
  return { path, line, text, ranges: [] }
}

describe('groupMatchesByFile', () => {
  it('groups hits per file in first-seen order with a root-relative directory', () => {
    const groups = groupMatchesByFile(
      [
        match('/var/www/shop/app/Models/Order.php', 4),
        match('/var/www/shop/routes/web.php', 9),
        match('/var/www/shop/app/Models/Order.php', 12)
      ],
      '/var/www/shop'
    )
    expect(groups.map((g) => g.name)).toEqual(['Order.php', 'web.php'])
    expect(groups[0].dir).toBe('app/Models')
    expect(groups[0].hits.map((h) => h.match.line)).toEqual([4, 12])
    expect(groups[1].dir).toBe('routes')
  })

  it('keeps the full directory when the file is outside the root', () => {
    const [group] = groupMatchesByFile([match('/etc/nginx/nginx.conf', 1)], '/var/www/shop')
    expect(group.dir).toBe('/etc/nginx')
  })

  it('uses an empty directory for a file directly in the root', () => {
    const [group] = groupMatchesByFile([match('/var/www/shop/index.php', 1)], '/var/www/shop/')
    expect(group.dir).toBe('')
  })

  it('gives each hit a unique key', () => {
    const [group] = groupMatchesByFile([match('/a.php', 1), match('/a.php', 2)])
    expect(new Set(group.hits.map((h) => h.key)).size).toBe(2)
  })
})

describe('splitByRanges', () => {
  it('splits the text around a range', () => {
    expect(splitByRanges('use OrderRefunded;', [[4, 17]])).toEqual([
      { text: 'use ', hit: false },
      { text: 'OrderRefunded', hit: true },
      { text: ';', hit: false }
    ])
  })

  it('handles several ranges given out of order', () => {
    const parts = splitByRanges('abcabc', [[3, 6], [0, 3]])
    expect(parts.map((p) => p.text)).toEqual(['abc', 'abc'])
    expect(parts.every((p) => p.hit)).toBe(true)
  })

  it('merges overlapping ranges and clamps to the text length', () => {
    const parts = splitByRanges('abcdef', [[1, 4], [3, 99]])
    expect(parts).toEqual([
      { text: 'a', hit: false },
      { text: 'bcd', hit: true },
      { text: 'ef', hit: true }
    ])
  })

  it('returns the plain text when there are no usable ranges', () => {
    expect(splitByRanges('abc', [])).toEqual([{ text: 'abc', hit: false }])
    expect(splitByRanges('abc', [[2, 2]])).toEqual([{ text: 'abc', hit: false }])
  })
})

describe('defaultSearchRoot', () => {
  it('prefers the sftp path, then the site root, then the default directory', () => {
    expect(defaultSearchRoot({ sftpPath: '/srv/a', siteRoot: '/var/www/shop', defaultDirectory: '/home/deploy' })).toBe('/srv/a')
    expect(defaultSearchRoot({ siteRoot: '/var/www/shop', defaultDirectory: '/home/deploy' })).toBe('/var/www/shop')
    expect(defaultSearchRoot({ defaultDirectory: '/home/deploy' })).toBe('/home/deploy')
  })

  it('skips blank values and falls back to an empty string', () => {
    expect(defaultSearchRoot({ sftpPath: '  ', siteRoot: '' })).toBe('')
  })
})

describe('counts', () => {
  it('counts distinct files', () => {
    expect(countFiles([match('/a', 1), match('/a', 2), match('/b', 1)])).toBe(2)
  })

  it('formats thousands', () => {
    expect(formatCount(2000)).toBe('2,000')
  })
})
