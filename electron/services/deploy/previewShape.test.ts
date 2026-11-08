import { describe, it, expect } from 'vitest'
import type { ShipFile } from '../../../src/types/deploy'
import { isMigrationPath, makeShipPreview, orderFiles } from './previewShape'

const file = (path: string, migration: boolean): ShipFile => ({ status: 'M', path, added: 1, removed: 0, migration })

describe('previewShape', () => {
  it('matches files inside the migrations folder, with or without a trailing slash', () => {
    expect(isMigrationPath('database/migrations/001.php', 'database/migrations')).toBe(true)
    expect(isMigrationPath('database/migrations/001.php', 'database/migrations/')).toBe(true)
    expect(isMigrationPath('database/migrations_old/001.php', 'database/migrations')).toBe(false)
    expect(isMigrationPath('anything.php', '')).toBe(false)
  })

  it('puts migrations first and keeps the rest in order', () => {
    const ordered = orderFiles([file('a', false), file('m1', true), file('b', false), file('m2', true)])
    expect(ordered.map((f) => f.path)).toEqual(['m1', 'm2', 'a', 'b'])
  })

  it('marks a preview truncated when a total exceeds what is listed', () => {
    const parts = { from: '', to: 'b', branch: 'main', commits: [], files: [file('a', false)], totalCommits: 0, totalFiles: 1 }
    expect(makeShipPreview(parts).truncated).toBe(false)
    expect(makeShipPreview({ ...parts, totalFiles: 2 }).truncated).toBe(true)
  })
})
