import type { AttentionItem, ProbeDefinition, ServerFacts } from '@/types/server/core'
import { keyValueLines, percentOf, toNumber } from './format'
import { LOAD_PROBE, METRICS_ROUTE } from './ids'

export interface LoadSample {
  cpuPercent: number
  cpus: number
  load: [number, number, number]
  memTotalBytes: number
  memAvailableBytes: number
  swapTotalBytes: number
  swapFreeBytes: number
  rxPerSec: number
  txPerSec: number
}

const SAMPLE = [
  "awk -v n=\"$1\" '/^cpu /{printf \"cpu%s=%.0f %.0f\\n\", n, $2+$3+$4+$5+$6+$7+$8+$9, $5+$6}' /proc/stat",
  "awk -v n=\"$1\" 'NR>2{gsub(\":\",\" \");if($1!=\"lo\" && $1!~/^(veth|docker|br-|virbr)/){rx+=$2;tx+=$10}}END{printf \"net%s=%.0f %.0f\\n\", n, rx, tx}' /proc/net/dev"
]

const LOAD_SCRIPT = [
  'export LC_ALL=C',
  `sample() { ${SAMPLE.join('; ')}; }`,
  'sample 1',
  'sleep 1',
  'sample 2',
  'echo "cpus=$(nproc 2>/dev/null || echo 0)"',
  "awk '{print \"load=\" $1, $2, $3}' /proc/loadavg",
  "awk '/^MemTotal:/{print \"mem_total=\" $2} /^MemAvailable:/{print \"mem_available=\" $2} /^SwapTotal:/{print \"swap_total=\" $2} /^SwapFree:/{print \"swap_free=\" $2}' /proc/meminfo",
  ''
].join('\n')

const pair = (value: string | undefined): [number, number] => {
  const [a, b] = (value ?? '').split(/\s+/).map(Number)
  return [Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 0]
}

const kib = (value: string | undefined): number => (toNumber(value) ?? 0) * 1024

function cpuPercent(first: [number, number], second: [number, number]): number {
  const total = second[0] - first[0]
  const idle = second[1] - first[1]
  return total > 0 ? Math.round(percentOf(total - idle, total)) : 0
}

export function parseLoad(stdout: string): LoadSample {
  const values = keyValueLines(stdout)
  const [rx1, tx1] = pair(values.get('net1'))
  const [rx2, tx2] = pair(values.get('net2'))
  const load = (values.get('load') ?? '').split(/\s+/).map(Number)
  return {
    cpuPercent: cpuPercent(pair(values.get('cpu1')), pair(values.get('cpu2'))),
    cpus: toNumber(values.get('cpus')) ?? 0,
    load: [load[0] || 0, load[1] || 0, load[2] || 0],
    memTotalBytes: kib(values.get('mem_total')),
    memAvailableBytes: kib(values.get('mem_available')),
    swapTotalBytes: kib(values.get('swap_total')),
    swapFreeBytes: kib(values.get('swap_free')),
    rxPerSec: Math.max(0, rx2 - rx1),
    txPerSec: Math.max(0, tx2 - tx1)
  }
}

export const loadProbe: ProbeDefinition<LoadSample> = {
  id: LOAD_PROBE,
  area: 'overview',
  root: false,
  timeoutSeconds: 10,
  script: LOAD_SCRIPT,
  parse: parseLoad
}

const LOW_MEMORY_PERCENT = 10
const HEAVY_SWAP_PERCENT = 50

export function memoryAttention(facts: ServerFacts): AttentionItem[] {
  const result = facts[LOAD_PROBE]
  if (result?.status !== 'ok') return []
  const sample = result.data as LoadSample
  if (sample.memTotalBytes <= 0) return []
  const availablePercent = percentOf(sample.memAvailableBytes, sample.memTotalBytes)
  const swapUsedPercent = percentOf(sample.swapTotalBytes - sample.swapFreeBytes, sample.swapTotalBytes)
  if (availablePercent >= LOW_MEMORY_PERCENT) return []
  const swapNote = swapUsedPercent >= HEAVY_SWAP_PERCENT ? ` · swap ${Math.round(swapUsedPercent)}% used` : ''
  return [{
    id: 'overview.memory',
    area: 'overview',
    level: 'warning',
    rank: 60,
    title: 'Memory is almost full',
    detail: `Only ${Math.round(availablePercent)}% free${swapNote}. Apps may slow down or be stopped.`,
    actionLabel: 'View',
    route: METRICS_ROUTE
  }]
}
