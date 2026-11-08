export type ChartHue = 'blue' | 'orange' | 'red' | 'purple' | 'cyan' | 'yellow' | 'emerald' | 'memory'

export const chartColor = (hue: ChartHue): string => `rgb(var(--nd-chart-${hue}))`

export const CHART_SWATCH: Record<ChartHue, string> = {
  blue: 'bg-nd-chart-blue',
  orange: 'bg-nd-chart-orange',
  red: 'bg-nd-chart-red',
  purple: 'bg-nd-chart-purple',
  cyan: 'bg-nd-chart-cyan',
  yellow: 'bg-nd-chart-yellow',
  emerald: 'bg-nd-chart-emerald',
  memory: 'bg-nd-chart-memory'
}

export const SERIES = {
  cpuUser: 'blue',
  cpuSystem: 'orange',
  cpuIowait: 'red',
  cpuSteal: 'purple',
  cpuNice: 'cyan',
  cpuIrq: 'yellow',
  memory: 'memory',
  memAvailable: 'emerald',
  memCached: 'blue',
  memBuffers: 'cyan',
  inbound: 'emerald',
  outbound: 'orange'
} as const satisfies Record<string, ChartHue>
