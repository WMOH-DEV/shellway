import { describe, expect, it } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { LOAD_PROBE, METRICS_ROUTE } from './ids'
import { memoryAttention, parseLoad, type LoadSample } from './load'

const OUTPUT = [
  'cpu1=1000 800',
  'net1=5000 2000',
  'cpu2=1200 900',
  'net2=7048 3024',
  'cpus=4',
  'load=0.84 0.50 0.31',
  'mem_total=8000000',
  'mem_available=3000000',
  'swap_total=2000000',
  'swap_free=2000000'
].join('\n')

const sample = (overrides: Partial<LoadSample>): LoadSample => ({ ...parseLoad(OUTPUT), ...overrides })

const factsWith = (data: LoadSample): ServerFacts => ({ [LOAD_PROBE]: { status: 'ok', data, at: 1 } })

describe('parseLoad', () => {
  it('computes CPU use and network rate from two samples one second apart', () => {
    expect(parseLoad(OUTPUT)).toEqual({
      cpuPercent: 50,
      cpus: 4,
      load: [0.84, 0.5, 0.31],
      memTotalBytes: 8000000 * 1024,
      memAvailableBytes: 3000000 * 1024,
      swapTotalBytes: 2000000 * 1024,
      swapFreeBytes: 2000000 * 1024,
      rxPerSec: 2048,
      txPerSec: 1024
    })
  })

  it('returns zeros for empty output instead of failing', () => {
    const parsed = parseLoad('')
    expect(parsed.cpuPercent).toBe(0)
    expect(parsed.memTotalBytes).toBe(0)
    expect(parsed.load).toEqual([0, 0, 0])
  })

  it('never reports a negative rate after a counter reset', () => {
    expect(parseLoad('net1=9000 9000\nnet2=10 10').rxPerSec).toBe(0)
  })
})

describe('memoryAttention', () => {
  it('stays quiet with enough free memory', () => {
    expect(memoryAttention(factsWith(sample({})))).toEqual([])
  })

  it('warns when less than 10% of memory is free and mentions heavy swap', () => {
    const items = memoryAttention(factsWith(sample({ memAvailableBytes: 0.05 * 8000000 * 1024, swapFreeBytes: 0.2 * 2000000 * 1024 })))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ level: 'warning', title: 'Memory is almost full', route: METRICS_ROUTE })
    expect(items[0].detail).toContain('5% free')
    expect(items[0].detail).toContain('swap 80% used')
  })

  it('ignores missing or failed probes', () => {
    expect(memoryAttention({})).toEqual([])
    expect(memoryAttention({ [LOAD_PROBE]: { status: 'unavailable', reason: 'x', at: 1 } })).toEqual([])
  })
})
