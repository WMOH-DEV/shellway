import { useRef, useEffect, useMemo } from 'react'
import { cn } from '@/utils/cn'

// ── Shared formatting utilities ──

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${sizes[i]}`
}

export function formatBytesPerSec(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B/s'
  const k = 1024
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function formatPercent(val: number): string {
  return `${val.toFixed(1)}%`
}

// ── Color utilities ──

/** Get color for a percentage value (green → yellow → red) */
export function getPercentColor(pct: number): string {
  if (pct < 50) return 'text-emerald-400'
  if (pct < 75) return 'text-amber-400'
  if (pct < 90) return 'text-orange-400'
  return 'text-red-400'
}

export function getPercentBg(pct: number): string {
  if (pct < 50) return 'bg-emerald-400'
  if (pct < 75) return 'bg-amber-400'
  if (pct < 90) return 'bg-orange-400'
  return 'bg-red-400'
}

export function getPercentBgAlpha(pct: number): string {
  if (pct < 50) return 'bg-emerald-400/15'
  if (pct < 75) return 'bg-amber-400/15'
  if (pct < 90) return 'bg-orange-400/15'
  return 'bg-red-400/15'
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'active': case 'running': return 'text-emerald-400'
    case 'inactive': case 'dead': case 'exited': return 'text-nd-text-muted'
    case 'failed': return 'text-red-400'
    default: return 'text-nd-text-secondary'
  }
}

export function getStatusDot(status: string): string {
  switch (status) {
    case 'active': case 'running': return 'bg-emerald-400'
    case 'inactive': case 'dead': case 'exited': return 'bg-nd-text-muted'
    case 'failed': return 'bg-red-400'
    default: return 'bg-nd-text-secondary'
  }
}

// ── Sparkline (SVG mini chart) ──

interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  color?: string
  fillColor?: string
  className?: string
  showArea?: boolean
  min?: number
  max?: number
}

export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = 'rgb(var(--nd-accent))',
  fillColor,
  className,
  showArea = true,
  min: minOverride,
  max: maxOverride
}: SparklineProps) {
  if (data.length < 2) {
    return (
      <svg width={width} height={height} className={cn('shrink-0', className)}>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={color} strokeOpacity={0.2} strokeWidth={1} />
      </svg>
    )
  }

  const pad = 1
  const min = minOverride ?? Math.min(...data)
  const max = maxOverride ?? Math.max(...data)
  const range = max - min || 1

  const points = data.map((val, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2)
    const y = height - pad - ((val - min) / range) * (height - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  const linePath = points.join(' ')
  const areaPath = `${points.join(' ')} ${width - pad},${height} ${pad},${height}`

  return (
    <svg width={width} height={height} className={cn('shrink-0', className)} viewBox={`0 0 ${width} ${height}`}>
      {showArea && (
        <polygon
          points={areaPath}
          fill={fillColor || color}
          fillOpacity={0.08}
        />
      )}
      <polyline
        points={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── Area Chart (larger, with grid and labels) ──

interface AreaChartProps {
  data: Array<{ values: number[]; color: string; label: string }>
  width?: number
  height?: number
  className?: string
  maxY?: number
  yLabel?: string
  stacked?: boolean
}

export function AreaChart({
  data,
  height = 100,
  className,
  maxY,
  stacked = false
}: AreaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Use container width for responsive sizing
  useEffect(() => {
    if (!containerRef.current || !svgRef.current) return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      if (svgRef.current) {
        svgRef.current.setAttribute('viewBox', `0 0 ${w} ${height}`)
        svgRef.current.setAttribute('width', String(w))
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [height])

  const width = containerRef.current?.clientWidth ?? 400

  // Determine max value across all series
  const allValues = data.flatMap(d => d.values)
  const computedMax = maxY ?? Math.max(...allValues, 1)
  const len = data[0]?.values.length ?? 0

  if (len < 2) return <div ref={containerRef} className={cn('w-full', className)} style={{ height }} />

  // Grid lines
  const gridLines = [0, 25, 50, 75, 100].filter(v => v <= computedMax)

  return (
    <div ref={containerRef} className={cn('w-full relative', className)} style={{ height }}>
      <svg ref={svgRef} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="absolute inset-0">
        {/* Grid lines */}
        {gridLines.map(v => {
          const y = height - (v / computedMax) * height
          return (
            <g key={v}>
              <line x1={0} y1={y} x2={width} y2={y} stroke="currentColor" strokeOpacity={0.06} strokeWidth={1} />
              <text x={4} y={y - 3} fill="currentColor" fillOpacity={0.3} fontSize={9} fontFamily="monospace">{v}%</text>
            </g>
          )
        })}

        {/* Data series */}
        {data.map((series, si) => {
          const pad = 0
          const points = series.values.map((val, i) => {
            const x = pad + (i / (len - 1)) * (width - pad * 2)
            const y = height - (Math.min(val, computedMax) / computedMax) * height
            return { x, y }
          })

          const line = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
          const area = `${line} ${width},${height} 0,${height}`

          return (
            <g key={si}>
              <polygon points={area} fill={series.color} fillOpacity={stacked ? 0.15 : 0.08} />
              <polyline
                points={line}
                fill="none"
                stroke={series.color}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Gauge (circular ring) ──

interface GaugeProps {
  value: number     // 0-100
  size?: number
  strokeWidth?: number
  label?: string
  sublabel?: string
  className?: string
}

export function Gauge({ value, size = 80, strokeWidth = 6, label, sublabel, className }: GaugeProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  const offset = circumference * (1 - pct / 100)

  const colorClass = pct < 50 ? 'stroke-emerald-400' : pct < 75 ? 'stroke-amber-400' : pct < 90 ? 'stroke-orange-400' : 'stroke-red-400'

  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.08}
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none"
            className={colorClass}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.6s ease-out' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={cn('text-sm font-bold tabular-nums', getPercentColor(pct))}>
            {pct.toFixed(0)}%
          </span>
        </div>
      </div>
      {label && <span className="text-[10px] font-medium text-nd-text-muted uppercase tracking-wider">{label}</span>}
      {sublabel && <span className="text-[10px] text-nd-text-muted tabular-nums">{sublabel}</span>}
    </div>
  )
}

// ── Progress Bar ──

interface ProgressBarProps {
  value: number     // 0-100
  height?: number
  className?: string
  showLabel?: boolean
  label?: string
}

export function ProgressBar({ value, height = 6, className, showLabel = false, label }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {label && <span className="text-xs text-nd-text-muted shrink-0 w-8">{label}</span>}
      <div className="flex-1 rounded-full overflow-hidden" style={{ height, background: 'rgba(255,255,255,0.04)' }}>
        <div
          className={cn('h-full rounded-full transition-all duration-500 ease-out', getPercentBg(pct))}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className={cn('text-xs font-mono tabular-nums shrink-0 w-10 text-right', getPercentColor(pct))}>
          {pct.toFixed(0)}%
        </span>
      )}
    </div>
  )
}

// ── Per-core CPU mini bar grid ──

interface CoreGridProps {
  cores: number[]
  className?: string
}

export function CoreGrid({ cores, className }: CoreGridProps) {
  return (
    <div className={cn('grid gap-1', className)} style={{ gridTemplateColumns: `repeat(${Math.min(cores.length, 8)}, 1fr)` }}>
      {cores.map((pct, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="text-[9px] text-nd-text-muted font-mono w-3 shrink-0">{i}</span>
          <div className="flex-1 h-2.5 rounded-sm overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <div
              className={cn('h-full rounded-sm transition-all duration-300', getPercentBg(pct))}
              style={{ width: `${Math.max(1, pct)}%` }}
            />
          </div>
          <span className={cn('text-[9px] font-mono tabular-nums w-7 text-right', getPercentColor(pct))}>
            {pct.toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Mirrored Network Chart (RX up, TX down) ──

interface MirroredChartProps {
  rxData: number[]
  txData: number[]
  height?: number
  className?: string
}

export function MirroredChart({ rxData, txData, height = 80, className }: MirroredChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const half = height / 2

  useEffect(() => {
    if (!containerRef.current || !svgRef.current) return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      if (svgRef.current) {
        svgRef.current.setAttribute('viewBox', `0 0 ${w} ${height}`)
        svgRef.current.setAttribute('width', String(w))
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [height])

  const width = containerRef.current?.clientWidth ?? 400
  const maxRx = Math.max(...rxData, 1)
  const maxTx = Math.max(...txData, 1)
  const maxVal = Math.max(maxRx, maxTx)
  const len = Math.max(rxData.length, txData.length)

  if (len < 2) return <div ref={containerRef} className={cn('w-full', className)} style={{ height }} />

  const buildPoints = (data: number[], flip: boolean) => {
    return data.map((val, i) => {
      const x = (i / (len - 1)) * width
      const norm = (val / maxVal) * half
      const y = flip ? half + norm : half - norm
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
  }

  const rxPoints = buildPoints(rxData, false)
  const txPoints = buildPoints(txData, true)

  return (
    <div ref={containerRef} className={cn('w-full relative', className)} style={{ height }}>
      <svg ref={svgRef} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="absolute inset-0">
        {/* Center line */}
        <line x1={0} y1={half} x2={width} y2={half} stroke="currentColor" strokeOpacity={0.08} strokeWidth={1} />

        {/* RX (download — above center) */}
        <polygon
          points={`${rxPoints.join(' ')} ${width},${half} 0,${half}`}
          fill="rgb(52, 211, 153)"
          fillOpacity={0.1}
        />
        <polyline
          points={rxPoints.join(' ')}
          fill="none"
          stroke="rgb(52, 211, 153)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* TX (upload — below center) */}
        <polygon
          points={`${txPoints.join(' ')} ${width},${half} 0,${half}`}
          fill="rgb(251, 146, 60)"
          fillOpacity={0.1}
        />
        <polyline
          points={txPoints.join(' ')}
          fill="none"
          stroke="rgb(251, 146, 60)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

// ── Metric Card wrapper ──

interface MetricCardProps {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
  headerRight?: React.ReactNode
}

export function MetricCard({ title, icon, children, className, headerRight }: MetricCardProps) {
  return (
    <div className={cn(
      'rounded-lg border border-nd-border/60 bg-nd-bg-secondary/50 overflow-hidden',
      className
    )}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-nd-border/40">
        <div className="flex items-center gap-1.5">
          {icon && <span className="text-nd-text-muted">{icon}</span>}
          <h3 className="text-xs font-semibold text-nd-text-secondary uppercase tracking-wider">{title}</h3>
        </div>
        {headerRight}
      </div>
      <div className="p-3">
        {children}
      </div>
    </div>
  )
}

// ── Stat item ──

interface StatItemProps {
  label: string
  value: string | number
  subvalue?: string
  valueClass?: string
  className?: string
}

export function StatItem({ label, value, subvalue, valueClass, className }: StatItemProps) {
  return (
    <div className={cn('flex flex-col', className)}>
      <span className="text-[10px] text-nd-text-muted uppercase tracking-wider">{label}</span>
      <span className={cn('text-sm font-semibold tabular-nums', valueClass || 'text-nd-text-primary')}>
        {value}
      </span>
      {subvalue && <span className="text-[10px] text-nd-text-muted tabular-nums">{subvalue}</span>}
    </div>
  )
}
