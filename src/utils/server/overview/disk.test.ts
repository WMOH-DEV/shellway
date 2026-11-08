import { describe, expect, it } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { diskAttention, parseDisk, rootFilesystem, type Filesystem } from './disk'
import { DISK_PROBE, DISK_ROUTE } from './ids'

const DF = [
  'Filesystem     Type     1024-blocks     Used Available Capacity Mounted on',
  '/dev/vda1      ext4        83886080 69206016  14680064      83% /',
  'tmpfs          tmpfs         817040     1100    815940       1% /run',
  '/dev/vda15     vfat          106858     6182    100677       6% /boot/efi',
  '/dev/vdb1      xfs        104857600 10485760  94371840      10% /mnt/my data',
  '/dev/vda1      ext4        83886080 69206016  14680064      83% /var/lib/docker/bind',
  'garbage line'
].join('\n')

const fs = (mount: string, usedPercent: number): Filesystem => ({ device: `/dev/${mount}`, type: 'ext4', sizeBytes: 100, usedBytes: usedPercent, availBytes: 100 - usedPercent, usedPercent, mount })

const factsWith = (data: Filesystem[]): ServerFacts => ({ [DISK_PROBE]: { status: 'ok', data, at: 1 } })

describe('parseDisk', () => {
  const parsed = parseDisk(DF)

  it('keeps real filesystems, drops tmpfs and bind duplicates, keeps mounts with spaces', () => {
    expect(parsed.map((f) => f.mount)).toEqual(['/', '/boot/efi', '/mnt/my data'])
  })

  it('reads sizes in bytes and the used percentage', () => {
    expect(rootFilesystem(parsed)).toEqual({ device: '/dev/vda1', type: 'ext4', sizeBytes: 83886080 * 1024, usedBytes: 69206016 * 1024, availBytes: 14680064 * 1024, usedPercent: 83, mount: '/' })
  })

  it('returns nothing for empty output', () => {
    expect(parseDisk('')).toEqual([])
    expect(rootFilesystem([])).toBeNull()
  })
})

describe('diskAttention', () => {
  it.each([
    [79, null],
    [80, 'warning'],
    [89, 'warning'],
    [90, 'error'],
    [100, 'error']
  ])('%d%% full -> %s', (percent, level) => {
    const items = diskAttention(factsWith([fs('/', percent)]))
    expect(items[0]?.level ?? null).toBe(level)
  })

  it('ranks fuller disks higher within their level band', () => {
    const [low] = diskAttention(factsWith([fs('/', 80)]))
    const [high] = diskAttention(factsWith([fs('/', 88)]))
    const [error] = diskAttention(factsWith([fs('/', 99)]))
    expect(low.rank).toBeLessThan(high.rank)
    expect(high.rank).toBeLessThan(100)
    expect(error.rank).toBeGreaterThanOrEqual(100)
    expect(error.rank).toBeLessThan(200)
  })

  it('names other mounts and links to the disk page', () => {
    const [item] = diskAttention(factsWith([fs('/data', 92)]))
    expect(item).toMatchObject({ title: 'Disk /data 92% full', actionLabel: 'Clean up', route: DISK_ROUTE })
  })

  it('ignores a missing probe', () => {
    expect(diskAttention({})).toEqual([])
  })
})
