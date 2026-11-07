import { describe, expect, it } from 'vitest'
import { parseFolders } from './folders'

const OUTPUT = [
  '4\t/lost+found',
  '6400000\t/var/log',
  '9800000\t/var/lib',
  '16300000\t/var',
  '3100000\t/usr',
  '120\t/etc',
  '22000000\t/',
  '@@exit=0'
].join('\n')

describe('parseFolders', () => {
  it('lists top-level folders and /var children, biggest first', () => {
    const usage = parseFolders(OUTPUT)
    expect(usage.root.map((f) => f.path)).toEqual(['/var', '/usr', '/etc', '/lost+found'])
    expect(usage.root[0].sizeBytes).toBe(16300000 * 1024)
    expect(usage.var.map((f) => f.path)).toEqual(['/var/lib', '/var/log'])
    expect(usage.partial).toBe(false)
  })

  it('marks a scan cut off by the time limit as partial', () => {
    expect(parseFolders('120\t/etc\n@@exit=124').partial).toBe(true)
  })

  it('keeps at most 10 entries per list', () => {
    const many = Array.from({ length: 15 }, (_, i) => `${i + 1}\t/d${i}`).join('\n')
    expect(parseFolders(many).root).toHaveLength(10)
  })
})
