import { describe, expect, it } from 'vitest'
import type { MonitorSnapshot } from '@/types/monitor'
import { healthCells, sampleFromProbe, sampleFromSnapshot, type HealthSample } from './health'
import type { LoadSample } from '@/utils/server/overview/load'

const GB = 1024 ** 3
const MB = 1024 ** 2

const base: HealthSample = {
  cpuPercent: 34,
  cpus: 4,
  load1: 0.84,
  memUsedBytes: 4.9 * GB,
  memTotalBytes: 8 * GB,
  swapUsedPercent: 0,
  disk: { usedBytes: 66 * GB, sizeBytes: 80 * GB, usedPercent: 82, mount: '/' },
  rxPerSec: 1.4 * MB,
  txPerSec: 0.7 * MB,
  netPeak: 4.2 * MB
}

describe('healthCells', () => {
  it('builds the four cells like the design', () => {
    const [cpu, memory, disk, network] = healthCells(base)
    expect(cpu).toMatchObject({ value: '34%', tone: 'success', meta: '4 vCPU · load 0.84' })
    expect(memory).toMatchObject({ value: '61%', tone: 'success', meta: '4.9 of 8 GB · swap 0%' })
    expect(disk).toMatchObject({ value: '82%', tone: 'warning', meta: '66 of 80 GB on /' })
    expect(network).toMatchObject({ value: '2.1 MB/s', tone: 'info', meta: '↓ 1.4 · ↑ 0.7 MB/s' })
    expect(network.percent).toBeCloseTo(50)
  })

  it.each([
    [69, 'success'],
    [70, 'warning'],
    [89, 'warning'],
    [90, 'error']
  ])('CPU %d%% uses the Monitor threshold %s', (cpuPercent, tone) => {
    expect(healthCells({ ...base, cpuPercent })[0].tone).toBe(tone)
  })

  it('shows a neutral disk cell when there is no disk data', () => {
    expect(healthCells({ ...base, disk: null })[2]).toMatchObject({ value: '—', tone: 'neutral', percent: 0 })
  })
})

describe('samples', () => {
  const snapshot = {
    cpuPercent: 12,
    cpuCount: 2,
    load: [0.5, 0.4, 0.3],
    memUsedBytes: GB,
    memTotalBytes: 2 * GB,
    swapUsedPercent: 10,
    disks: [
      { filesystem: '/dev/vdb', type: 'ext4', sizeBytes: 10, usedBytes: 5, availBytes: 5, mountpoint: '/data', usedPercent: 50 },
      { filesystem: '/dev/vda', type: 'ext4', sizeBytes: 100, usedBytes: 40, availBytes: 60, mountpoint: '/', usedPercent: 40 }
    ],
    netInterfaces: [{ name: 'eth0', rxBytesPerSec: 100, txBytesPerSec: 50, rxTotalBytes: 0, txTotalBytes: 0 }]
  } as unknown as MonitorSnapshot

  it('reads a monitor snapshot, picking / and the peak network rate from history', () => {
    const louder = { ...snapshot, netInterfaces: [{ ...snapshot.netInterfaces[0], rxBytesPerSec: 600 }] } as MonitorSnapshot
    const sample = sampleFromSnapshot(snapshot, [louder])
    expect(sample).toMatchObject({ cpuPercent: 12, cpus: 2, load1: 0.5, rxPerSec: 100, txPerSec: 50, netPeak: 650 })
    expect(sample.disk).toEqual({ usedBytes: 40, sizeBytes: 100, usedPercent: 40, mount: '/' })
  })

  it('reads the fallback probe', () => {
    const load: LoadSample = { cpuPercent: 20, cpus: 1, load: [1, 1, 1], memTotalBytes: 1000, memAvailableBytes: 250, swapTotalBytes: 100, swapFreeBytes: 75, rxPerSec: 1, txPerSec: 2 }
    const sample = sampleFromProbe(load, [{ device: '/dev/vda', type: 'ext4', sizeBytes: 10, usedBytes: 9, availBytes: 1, usedPercent: 90, mount: '/' }])
    expect(sample).toMatchObject({ memUsedBytes: 750, swapUsedPercent: 25, netPeak: 0, disk: { usedPercent: 90, mount: '/' } })
    expect(sampleFromProbe(load, null).disk).toBeNull()
  })
})
