import { useState, useEffect, useRef, useCallback } from 'react'
import { Activity, Clock, Wifi, Server, Hash } from 'lucide-react'
import { cn } from '@/utils/cn'

interface ConnectionHealthDashboardProps {
  connectionId: string
  sessionName: string
  status: string
}

interface HealthData {
  connectedAt: number
  latencyMs: number
  latencyHistory: number[]
  serverInfo: {
    serverVersion: string
    clientVersion: string
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function LatencySparkline({ readings }: { readings: number[] }) {
  if (readings.length < 2) return null

  const width = 120
  const height = 30
  const padding = 2

  const min = Math.min(...readings)
  const max = Math.max(...readings)
  const range = max - min || 1

  const points = readings
    .map((val, i) => {
      const x = padding + (i / (readings.length - 1)) * (width - padding * 2)
      const y = height - padding - ((val - min) / range) * (height - padding * 2)
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg
      width={width}
      height={height}
      className="inline-block"
      viewBox={`0 0 ${width} ${height}`}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-nd-accent"
      />
    </svg>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    connected: 'bg-nd-success/20 text-nd-success',
    connecting: 'bg-yellow-500/20 text-yellow-400',
    authenticating: 'bg-yellow-500/20 text-yellow-400',
    reconnecting: 'bg-orange-500/20 text-orange-400',
    paused: 'bg-nd-text-muted/20 text-nd-text-muted',
    error: 'bg-nd-error/20 text-nd-error',
    disconnected: 'bg-nd-text-muted/20 text-nd-text-muted'
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
        colorMap[status] ?? 'bg-nd-text-muted/20 text-nd-text-muted'
      )}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          status === 'connected' ? 'bg-nd-success animate-pulse' : 'bg-current'
        )}
      />
      {status}
    </span>
  )
}

export function ConnectionHealthDashboard({
  connectionId,
  sessionName,
  status
}: ConnectionHealthDashboardProps) {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [duration, setDuration] = useState<string>('--')
  const connectedAtRef = useRef<number | null>(null)

  // Fetch health data every 10 seconds
  const fetchHealth = useCallback(async () => {
    try {
      const data = await window.novadeck.health.getHealth(connectionId)
      if (data) {
        setHealth(data)
        connectedAtRef.current = data.connectedAt
      }
    } catch {
      // Connection may have been closed
    }
  }, [connectionId])

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 10_000)
    return () => clearInterval(interval)
  }, [fetchHealth])

  // Update duration every second
  useEffect(() => {
    const tick = () => {
      if (connectedAtRef.current && status === 'connected') {
        setDuration(formatDuration(Date.now() - connectedAtRef.current))
      } else {
        setDuration('--')
      }
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [status])

  const latency = health?.latencyMs ?? -1
  const latencyHistory = health?.latencyHistory ?? []

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <h3 className="text-sm font-semibold text-nd-text-primary">
        Connection Health
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Session */}
        <div className="bg-nd-surface/50 border border-nd-border/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-nd-text-muted mb-2">
            <Server size={14} />
            <span className="text-xs font-medium uppercase tracking-wide">Session</span>
          </div>
          <p className="text-sm text-nd-text-primary font-medium truncate">
            {sessionName}
          </p>
        </div>

        {/* Status */}
        <div className="bg-nd-surface/50 border border-nd-border/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-nd-text-muted mb-2">
            <Activity size={14} />
            <span className="text-xs font-medium uppercase tracking-wide">Status</span>
          </div>
          <StatusBadge status={status} />
        </div>

        {/* Connected Duration */}
        <div className="bg-nd-surface/50 border border-nd-border/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-nd-text-muted mb-2">
            <Clock size={14} />
            <span className="text-xs font-medium uppercase tracking-wide">Uptime</span>
          </div>
          <p className="text-sm text-nd-text-primary font-mono">
            {duration}
          </p>
        </div>

        {/* Latency */}
        <div className="bg-nd-surface/50 border border-nd-border/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-nd-text-muted mb-2">
            <Wifi size={14} />
            <span className="text-xs font-medium uppercase tracking-wide">Latency</span>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-sm text-nd-text-primary font-mono">
              {latency >= 0 ? `${latency}ms` : '--'}
            </p>
            <LatencySparkline readings={latencyHistory} />
          </div>
        </div>

        {/* Server Version */}
        <div className="bg-nd-surface/50 border border-nd-border/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-nd-text-muted mb-2">
            <Server size={14} />
            <span className="text-xs font-medium uppercase tracking-wide">Server Version</span>
          </div>
          <p className="text-xs text-nd-text-secondary font-mono truncate">
            {health?.serverInfo?.serverVersion || '--'}
          </p>
          <p className="text-xs text-nd-text-muted font-mono mt-1 truncate">
            Client: {health?.serverInfo?.clientVersion || '--'}
          </p>
        </div>

        {/* Connection ID */}
        <div className="bg-nd-surface/50 border border-nd-border/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-nd-text-muted mb-2">
            <Hash size={14} />
            <span className="text-xs font-medium uppercase tracking-wide">Connection ID</span>
          </div>
          <p className="text-xs text-nd-text-secondary font-mono break-all">
            {connectionId}
          </p>
        </div>
      </div>
    </div>
  )
}
