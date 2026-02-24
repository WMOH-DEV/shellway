import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import {
  Cpu, MemoryStick, HardDrive, Network, Server, Activity, Shield,
  Container, Thermometer, RefreshCw,
  ChevronDown, ChevronRight, Search, X, Signal, Skull,
  Copy, Check, ArrowUpDown, ArrowUp, ArrowDown
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { toast } from '@/components/ui/Toast'
import { useMonitorStore } from '@/stores/monitorStore'
import type { MonitorSnapshot, MonitorStatus } from '@/types/monitor'
import type { ConnectionStatus } from '@/types/session'
import {
  MetricCard, Gauge, ProgressBar, Sparkline, AreaChart, MirroredChart,
  CoreGrid, StatItem,
  formatBytes, formatBytesPerSec, formatUptime, formatPercent,
  getPercentColor, getPercentBg, getPercentBgAlpha, getStatusColor, getStatusDot
} from './MonitorCharts'

interface MonitorViewProps {
  connectionId: string
  sessionId: string
  connectionStatus: ConnectionStatus
}

export function MonitorView({ connectionId, connectionStatus }: MonitorViewProps) {
  const { snapshots, history, status, errors, pushSnapshot, setHistory, setStatus, setError } = useMonitorStore()
  const snapshot = snapshots.get(connectionId) ?? null
  const historyData = history.get(connectionId) ?? []
  const monitorStatus = status.get(connectionId) ?? 'stopped'
  const errorMsg = errors.get(connectionId) ?? null
  const [processFilter, setProcessFilter] = useState('')
  const [sortColumn, setSortColumn] = useState<'pid' | 'name' | 'user' | 'cpuPercent' | 'memPercent' | 'rssBytes'>('cpuPercent')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const isMountedRef = useRef(true)

  // Toggle section collapse
  const toggleSection = useCallback((section: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }, [])

  // Toggle process sort column/direction
  const handleSort = useCallback((column: typeof sortColumn) => {
    if (sortColumn === column) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('desc')
    }
  }, [sortColumn])

  // Start monitoring when tab becomes visible
  useEffect(() => {
    isMountedRef.current = true

    if (connectionStatus !== 'connected') return

    const startMonitor = async () => {
      try {
        // Fetch existing history first
        const existingHistory = await window.novadeck.monitor.getHistory(connectionId) as MonitorSnapshot[]
        if (existingHistory.length > 0 && isMountedRef.current) {
          setHistory(connectionId, existingHistory)
        }

        await window.novadeck.monitor.start(connectionId)
      } catch (err) {
        console.warn('[Monitor] Failed to start:', err)
      }
    }

    startMonitor()

    return () => {
      isMountedRef.current = false
      // Stop monitoring when leaving the tab
      window.novadeck.monitor.stop(connectionId).catch(() => {})
    }
  }, [connectionId, connectionStatus, setHistory])

  // Listen for real-time data
  useEffect(() => {
    const unsubData = window.novadeck.monitor.onData((connId, data) => {
      if (connId === connectionId && isMountedRef.current) {
        pushSnapshot(connectionId, data as MonitorSnapshot)
      }
    })

    const unsubStatus = window.novadeck.monitor.onStatus((connId, s) => {
      if (connId === connectionId && isMountedRef.current) {
        setStatus(connectionId, s as MonitorStatus)
      }
    })

    const unsubError = window.novadeck.monitor.onError((connId, err) => {
      if (connId === connectionId && isMountedRef.current) {
        setError(connectionId, err)
      }
    })

    return () => {
      unsubData()
      unsubStatus()
      unsubError()
    }
  }, [connectionId, pushSnapshot, setStatus, setError])

  // Extract chart data from history
  const chartData = useMemo(() => {
    const cpuHistory = historyData.map(s => s.cpuPercent)
    const memHistory = historyData.map(s => s.memUsedPercent)
    const cpuUser = historyData.map(s => s.cpuBreakdown.user)
    const cpuSystem = historyData.map(s => s.cpuBreakdown.system)
    const cpuIowait = historyData.map(s => s.cpuBreakdown.iowait)

    // Network: aggregate all interfaces
    const rxHistory = historyData.map(s => s.netInterfaces.reduce((sum, n) => sum + n.rxBytesPerSec, 0))
    const txHistory = historyData.map(s => s.netInterfaces.reduce((sum, n) => sum + n.txBytesPerSec, 0))

    // Disk I/O: aggregate
    const diskReadHistory = historyData.map(s => (s.diskIO ?? []).reduce((sum, d) => sum + d.readBytesPerSec, 0))
    const diskWriteHistory = historyData.map(s => (s.diskIO ?? []).reduce((sum, d) => sum + d.writeBytesPerSec, 0))

    return { cpuHistory, memHistory, cpuUser, cpuSystem, cpuIowait, rxHistory, txHistory, diskReadHistory, diskWriteHistory }
  }, [historyData])

  // Filter processes
  const filteredProcesses = useMemo(() => {
    if (!snapshot) return []
    const procs = snapshot.processes || []
    if (!processFilter) return procs
    const lower = processFilter.toLowerCase()
    return procs.filter(p => p.name.toLowerCase().includes(lower) || String(p.pid).includes(lower) || (p.user?.toLowerCase().includes(lower)))
  }, [snapshot, processFilter])

  // Sort filtered processes
  const sortedProcesses = useMemo(() => {
    return [...filteredProcesses].sort((a, b) => {
      const col = sortColumn
      const aVal = col === 'name' ? a.name : col === 'user' ? (a.user ?? '') : a[col]
      const bVal = col === 'name' ? b.name : col === 'user' ? (b.user ?? '') : b[col]
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }
      const aNum = Number(aVal) || 0
      const bNum = Number(bVal) || 0
      return sortDirection === 'asc' ? aNum - bNum : bNum - aNum
    })
  }, [filteredProcesses, sortColumn, sortDirection])

  // Kill a process on the remote server
  const handleKillProcess = useCallback(async (pid: number, name: string, signal: number = 15) => {
    try {
      const result = await window.novadeck.monitor.killProcess(connectionId, pid, signal)
      if (result.success) {
        toast.success('Process killed', `Sent ${signal === 9 ? 'SIGKILL' : 'SIGTERM'} to ${name} (PID ${pid})`)
      } else {
        toast.error('Kill failed', result.error || 'Unknown error')
      }
    } catch (err) {
      toast.error('Kill failed', String(err))
    }
  }, [connectionId])

  // ── Not connected state ──
  if (connectionStatus !== 'connected') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <Activity size={40} className="mx-auto text-nd-text-muted opacity-30" />
          <p className="text-sm text-nd-text-muted">Connect to start monitoring</p>
        </div>
      </div>
    )
  }

  // ── Loading state ──
  if (!snapshot && !errorMsg) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <div className="relative mx-auto w-10 h-10">
            <RefreshCw size={24} className="mx-auto text-nd-accent animate-spin" />
          </div>
          <p className="text-sm text-nd-text-muted">Collecting server metrics...</p>
          <p className="text-xs text-nd-text-muted/60">First snapshot will appear in a few seconds</p>
        </div>
      </div>
    )
  }

  // ── Error state ──
  if (errorMsg && !snapshot) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3 max-w-md">
          <Shield size={40} className="mx-auto text-red-400 opacity-60" />
          <p className="text-sm text-red-400">{errorMsg}</p>
          <p className="text-xs text-nd-text-muted">The server may not support monitoring (e.g., non-Linux, containerized with limited /proc)</p>
        </div>
      </div>
    )
  }

  if (!snapshot) return null

  const isStale = monitorStatus === 'stale'
  const lastUpdated = snapshot.timestamp ? `${((Date.now() - snapshot.timestamp) / 1000).toFixed(0)}s ago` : '—'

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="p-4 space-y-4 max-w-[1600px] mx-auto">

        {/* ── Header: System Overview ── */}
        <div className={cn(
          'rounded-lg border overflow-hidden',
          isStale ? 'border-amber-500/40 bg-amber-500/5' : 'border-nd-border/60 bg-nd-bg-secondary/50'
        )}>
          <div className="px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <Server size={16} className="text-nd-accent shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-nd-text-primary truncate">{snapshot.hostname}</h2>
                  <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
                    isStale ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400'
                  )}>
                    <span className={cn('w-1.5 h-1.5 rounded-full', isStale ? 'bg-amber-400' : 'bg-emerald-400')} />
                    {isStale ? 'Stale' : 'Live'}
                  </span>
                </div>
                <p className="text-[11px] text-nd-text-muted truncate">
                  {snapshot.os || 'Linux'} &middot; {snapshot.kernel} &middot; {snapshot.cpuModel || `${snapshot.cpuCount} cores`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-nd-text-muted">
              <span className="flex items-center gap-1 tabular-nums">
                <Activity size={11} />
                Uptime: <span className="text-nd-text-secondary font-medium">{formatUptime(snapshot.uptime)}</span>
              </span>
              <span className="flex items-center gap-1 tabular-nums">
                <Signal size={11} />
                Updated: <span className="text-nd-text-secondary font-medium">{lastUpdated}</span>
              </span>
            </div>
          </div>

          {/* Quick overview bars */}
          <div className="px-4 py-2 border-t border-nd-border/30 grid grid-cols-4 gap-4">
            <QuickStat label="CPU" value={snapshot.cpuPercent} />
            <QuickStat label="Memory" value={snapshot.memUsedPercent} />
            <QuickStat label="Swap" value={snapshot.swapUsedPercent} />
            <QuickStat label="Load" value={snapshot.load[0]} max={snapshot.cpuCount} isLoad />
          </div>
        </div>

        {/* ── Main dashboard grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* CPU Section */}
          <SectionWrapper
            id="cpu"
            title="CPU"
            icon={<Cpu size={13} />}
            collapsed={collapsedSections.has('cpu')}
            onToggle={toggleSection}
            headerRight={
              <div className="flex items-center gap-2">
                <span className={cn('text-sm font-bold tabular-nums', getPercentColor(snapshot.cpuPercent))}>
                  {formatPercent(snapshot.cpuPercent)}
                </span>
                <CopyButton
                  data={{
                    cpuPercent: snapshot.cpuPercent,
                    breakdown: snapshot.cpuBreakdown,
                    loadAverage: { '1m': snapshot.load[0], '5m': snapshot.load[1], '15m': snapshot.load[2] },
                    cpuCount: snapshot.cpuCount,
                    cpuModel: snapshot.cpuModel,
                    perCoreCpu: snapshot.perCoreCpu
                  }}
                  label="CPU"
                />
              </div>
            }
          >
            <div className="space-y-3">
              {/* CPU Usage Chart */}
              <AreaChart
                height={90}
                maxY={100}
                data={[
                  { values: chartData.cpuUser, color: 'rgb(96, 165, 250)', label: 'User' },
                  { values: chartData.cpuSystem, color: 'rgb(251, 146, 60)', label: 'System' },
                  { values: chartData.cpuIowait, color: 'rgb(248, 113, 113)', label: 'IO Wait' }
                ]}
              />

              {/* CPU breakdown stats */}
              <div className="grid grid-cols-6 gap-2">
                <StatItem label="User" value={formatPercent(snapshot.cpuBreakdown.user)} valueClass="text-blue-400" />
                <StatItem label="System" value={formatPercent(snapshot.cpuBreakdown.system)} valueClass="text-orange-400" />
                <StatItem label="IO Wait" value={formatPercent(snapshot.cpuBreakdown.iowait)} valueClass="text-red-400" />
                <StatItem label="Steal" value={formatPercent(snapshot.cpuBreakdown.steal)} valueClass="text-purple-400" />
                <StatItem label="Nice" value={formatPercent(snapshot.cpuBreakdown.nice)} valueClass="text-cyan-400" />
                <StatItem label="IRQ" value={formatPercent(snapshot.cpuBreakdown.irq)} valueClass="text-yellow-400" />
              </div>

              {/* Load Average */}
              <div className="flex items-center gap-4 pt-1">
                <span className="text-[10px] text-nd-text-muted uppercase tracking-wider">Load Avg</span>
                <div className="flex gap-3">
                  {(['1m', '5m', '15m'] as const).map((period, i) => (
                    <span key={period} className="flex items-center gap-1">
                      <span className="text-[10px] text-nd-text-muted">{period}:</span>
                      <span className={cn(
                        'text-xs font-mono font-bold tabular-nums',
                        snapshot.load[i] > snapshot.cpuCount ? 'text-red-400' :
                        snapshot.load[i] > snapshot.cpuCount * 0.7 ? 'text-amber-400' : 'text-emerald-400'
                      )}>
                        {snapshot.load[i].toFixed(2)}
                      </span>
                    </span>
                  ))}
                  <span className="text-[10px] text-nd-text-muted ml-1">/ {snapshot.cpuCount} cores</span>
                </div>
              </div>

              {/* Per-core grid */}
              {snapshot.perCoreCpu && snapshot.perCoreCpu.length > 0 && (
                <div className="pt-1">
                  <p className="text-[10px] text-nd-text-muted uppercase tracking-wider mb-1.5">Per Core</p>
                  <CoreGrid cores={snapshot.perCoreCpu} />
                </div>
              )}
            </div>
          </SectionWrapper>

          {/* Memory Section */}
          <SectionWrapper
            id="memory"
            title="Memory"
            icon={<MemoryStick size={13} />}
            collapsed={collapsedSections.has('memory')}
            onToggle={toggleSection}
            headerRight={
              <div className="flex items-center gap-2">
                <span className={cn('text-sm font-bold tabular-nums', getPercentColor(snapshot.memUsedPercent))}>
                  {formatBytes(snapshot.memUsedBytes)} / {formatBytes(snapshot.memTotalBytes)}
                </span>
                <CopyButton
                  data={{
                    total: formatBytes(snapshot.memTotalBytes),
                    used: formatBytes(snapshot.memUsedBytes),
                    available: formatBytes(snapshot.memAvailableBytes),
                    cached: formatBytes(snapshot.memCachedBytes),
                    buffers: formatBytes(snapshot.memBuffersBytes),
                    usedPercent: snapshot.memUsedPercent,
                    swap: {
                      total: formatBytes(snapshot.swapTotalBytes),
                      used: formatBytes(snapshot.swapUsedBytes),
                      usedPercent: snapshot.swapUsedPercent
                    }
                  }}
                  label="Memory"
                />
              </div>
            }
          >
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <Gauge value={snapshot.memUsedPercent} size={72} label="RAM" sublabel={formatBytes(snapshot.memUsedBytes)} />
                {snapshot.swapTotalBytes > 0 && (
                  <Gauge value={snapshot.swapUsedPercent} size={72} label="Swap" sublabel={formatBytes(snapshot.swapUsedBytes)} />
                )}
                <div className="flex-1 space-y-2">
                  <ProgressBar value={snapshot.memUsedPercent} showLabel label="Used" />
                  <ProgressBar value={snapshot.memTotalBytes > 0 ? (snapshot.memCachedBytes / snapshot.memTotalBytes) * 100 : 0} showLabel label="Cache" />
                  <ProgressBar value={snapshot.memTotalBytes > 0 ? (snapshot.memBuffersBytes / snapshot.memTotalBytes) * 100 : 0} showLabel label="Buf" />
                </div>
              </div>

              {/* Memory sparkline */}
              <div>
                <p className="text-[10px] text-nd-text-muted uppercase tracking-wider mb-1">History</p>
                <AreaChart
                  height={50}
                  maxY={100}
                  data={[{ values: chartData.memHistory, color: 'rgb(168, 85, 247)', label: 'Memory' }]}
                />
              </div>

              <div className="grid grid-cols-4 gap-2">
                <StatItem label="Total" value={formatBytes(snapshot.memTotalBytes)} />
                <StatItem label="Available" value={formatBytes(snapshot.memAvailableBytes)} valueClass="text-emerald-400" />
                <StatItem label="Cached" value={formatBytes(snapshot.memCachedBytes)} valueClass="text-blue-400" />
                <StatItem label="Buffers" value={formatBytes(snapshot.memBuffersBytes)} valueClass="text-cyan-400" />
              </div>
            </div>
          </SectionWrapper>

          {/* Network Section */}
          <SectionWrapper
            id="network"
            title="Network"
            icon={<Network size={13} />}
            collapsed={collapsedSections.has('network')}
            onToggle={toggleSection}
            headerRight={
              <div className="flex items-center gap-3 text-xs tabular-nums">
                <span className="text-emerald-400">
                  ↓ {formatBytesPerSec(snapshot.netInterfaces.reduce((s, n) => s + n.rxBytesPerSec, 0))}
                </span>
                <span className="text-orange-400">
                  ↑ {formatBytesPerSec(snapshot.netInterfaces.reduce((s, n) => s + n.txBytesPerSec, 0))}
                </span>
                <CopyButton
                  data={snapshot.netInterfaces.map(iface => ({
                    name: iface.name,
                    rxPerSec: formatBytesPerSec(iface.rxBytesPerSec),
                    txPerSec: formatBytesPerSec(iface.txBytesPerSec),
                    totalRx: formatBytes(iface.rxTotalBytes),
                    totalTx: formatBytes(iface.txTotalBytes)
                  }))}
                  label="Network"
                />
              </div>
            }
          >
            <div className="space-y-3">
              {/* Mirrored RX/TX chart */}
              <MirroredChart
                rxData={chartData.rxHistory}
                txData={chartData.txHistory}
                height={70}
              />

              {/* Labels */}
              <div className="flex justify-center gap-4 text-[10px]">
                <span className="flex items-center gap-1"><span className="w-2 h-0.5 rounded bg-emerald-400" /> RX (Download)</span>
                <span className="flex items-center gap-1"><span className="w-2 h-0.5 rounded bg-orange-400" /> TX (Upload)</span>
              </div>

              {/* Per-interface details */}
              <div className="space-y-1">
                {snapshot.netInterfaces.map(iface => (
                  <div key={iface.name} className="flex items-center justify-between py-1 px-2 rounded bg-nd-bg-primary/50 text-xs">
                    <span className="font-mono text-nd-text-secondary">{iface.name}</span>
                    <div className="flex items-center gap-4 tabular-nums">
                      <span className="text-emerald-400">↓ {formatBytesPerSec(iface.rxBytesPerSec)}</span>
                      <span className="text-orange-400">↑ {formatBytesPerSec(iface.txBytesPerSec)}</span>
                      <span className="text-nd-text-muted text-[10px]">
                        Total: {formatBytes(iface.rxTotalBytes)} / {formatBytes(iface.txTotalBytes)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </SectionWrapper>

          {/* Disk Section */}
          <SectionWrapper
            id="disk"
            title="Disk"
            icon={<HardDrive size={13} />}
            collapsed={collapsedSections.has('disk')}
            onToggle={toggleSection}
            headerRight={
              <CopyButton
                data={{
                  disks: snapshot.disks.map(disk => ({
                    mountpoint: disk.mountpoint,
                    filesystem: disk.filesystem,
                    type: disk.type,
                    size: formatBytes(disk.sizeBytes),
                    used: formatBytes(disk.usedBytes),
                    available: formatBytes(disk.availBytes),
                    usedPercent: disk.usedPercent
                  })),
                  io: snapshot.diskIO?.map(d => ({
                    device: d.device,
                    readPerSec: formatBytesPerSec(d.readBytesPerSec),
                    writePerSec: formatBytesPerSec(d.writeBytesPerSec)
                  }))
                }}
                label="Disk"
              />
            }
          >
            <div className="space-y-3">
              {/* Disk usage table */}
              {snapshot.disks.length > 0 && (
                <div className="space-y-2">
                  {snapshot.disks.map((disk, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono text-nd-text-secondary truncate max-w-[200px]" title={disk.filesystem}>
                          {disk.mountpoint}
                        </span>
                        <span className="text-nd-text-muted tabular-nums">
                          {formatBytes(disk.usedBytes)} / {formatBytes(disk.sizeBytes)}
                        </span>
                      </div>
                      <ProgressBar value={disk.usedPercent} showLabel height={5} />
                    </div>
                  ))}
                </div>
              )}

              {/* Disk I/O chart */}
              {(chartData.diskReadHistory.some(v => v > 0) || chartData.diskWriteHistory.some(v => v > 0)) && (
                <div>
                  <p className="text-[10px] text-nd-text-muted uppercase tracking-wider mb-1">I/O Throughput</p>
                  <MirroredChart
                    rxData={chartData.diskReadHistory}
                    txData={chartData.diskWriteHistory}
                    height={50}
                  />
                  <div className="flex justify-center gap-4 text-[10px] mt-1">
                    <span className="flex items-center gap-1"><span className="w-2 h-0.5 rounded bg-emerald-400" /> Read</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-0.5 rounded bg-orange-400" /> Write</span>
                  </div>
                  {snapshot.diskIO && snapshot.diskIO.length > 0 && (
                    <div className="mt-2 space-y-0.5">
                      {snapshot.diskIO.map(d => (
                        <div key={d.device} className="flex items-center justify-between text-[11px] px-2 py-0.5">
                          <span className="font-mono text-nd-text-muted">{d.device}</span>
                          <div className="flex gap-3 tabular-nums">
                            <span className="text-emerald-400">R: {formatBytesPerSec(d.readBytesPerSec)}</span>
                            <span className="text-orange-400">W: {formatBytesPerSec(d.writeBytesPerSec)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </SectionWrapper>
        </div>

        {/* ── Processes Section (full width) ── */}
        <SectionWrapper
          id="processes"
          title="Processes"
          icon={<Activity size={13} />}
          collapsed={collapsedSections.has('processes')}
          onToggle={toggleSection}
          headerRight={
            <div className="flex items-center gap-2">
              <span className="text-xs text-nd-text-muted tabular-nums">{snapshot.processes.length} processes</span>
              <CopyButton
                data={sortedProcesses.map(p => ({
                  pid: p.pid,
                  name: p.name,
                  user: p.user || '—',
                  cpuPercent: p.cpuPercent,
                  memPercent: p.memPercent,
                  rss: formatBytes(p.rssBytes)
                }))}
                label="Processes"
              />
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-nd-text-muted" />
                <input
                  type="text"
                  value={processFilter}
                  onChange={e => setProcessFilter(e.target.value)}
                  placeholder="Filter..."
                  className="h-6 pl-6 pr-6 text-[11px] bg-nd-bg-primary border border-nd-border/50 rounded text-nd-text-primary placeholder:text-nd-text-muted/50 focus:outline-none focus:border-nd-accent/50 w-32"
                />
                {processFilter && (
                  <button onClick={() => setProcessFilter('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-nd-text-muted hover:text-nd-text-secondary">
                    <X size={10} />
                  </button>
                )}
              </div>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-nd-text-muted uppercase tracking-wider border-b border-nd-border/30">
                  <SortableHeader column="pid" label="PID" current={sortColumn} direction={sortDirection} onSort={handleSort} className="text-left w-16" />
                  <SortableHeader column="name" label="Process" current={sortColumn} direction={sortDirection} onSort={handleSort} className="text-left" />
                  <SortableHeader column="user" label="User" current={sortColumn} direction={sortDirection} onSort={handleSort} className="text-left w-20" />
                  <SortableHeader column="cpuPercent" label="CPU %" current={sortColumn} direction={sortDirection} onSort={handleSort} className="text-right w-20" />
                  <SortableHeader column="memPercent" label="MEM %" current={sortColumn} direction={sortDirection} onSort={handleSort} className="text-right w-20" />
                  <SortableHeader column="rssBytes" label="RSS" current={sortColumn} direction={sortDirection} onSort={handleSort} className="text-right w-24" />
                  <th className="py-1.5 px-1 w-8" />
                </tr>
              </thead>
              <tbody>
                {sortedProcesses.map((proc, i) => (
                  <tr
                    key={`${proc.pid}-${i}`}
                    className="group border-b border-nd-border/10 hover:bg-nd-surface/50 transition-colors cursor-pointer active:bg-nd-accent/10"
                    title="Click to copy process info"
                    onClick={() => {
                      const data = { pid: proc.pid, name: proc.name, user: proc.user || '—', cpuPercent: proc.cpuPercent, memPercent: proc.memPercent, rss: formatBytes(proc.rssBytes) }
                      navigator.clipboard.writeText(JSON.stringify(data, null, 2))
                        .then(() => toast.success('Copied', `${proc.name} (PID ${proc.pid}) copied to clipboard`))
                        .catch(() => toast.error('Copy failed', 'Unable to write to clipboard'))
                    }}
                  >
                    <td className="py-1 px-2 font-mono text-nd-text-muted tabular-nums">{proc.pid}</td>
                    <td className="py-1 px-2 font-mono text-nd-text-secondary truncate max-w-[200px]">{proc.name}</td>
                    <td className="py-1 px-2 text-nd-text-muted">{proc.user || '—'}</td>
                    <td className="py-1 px-2 text-right tabular-nums">
                      <span className={getPercentColor(proc.cpuPercent)}>{proc.cpuPercent.toFixed(1)}</span>
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums">
                      <span className={getPercentColor(proc.memPercent)}>{proc.memPercent.toFixed(1)}</span>
                    </td>
                    <td className="py-1 px-2 text-right text-nd-text-muted tabular-nums">{formatBytes(proc.rssBytes)}</td>
                    <td className="py-1 px-1" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleKillProcess(proc.pid, proc.name)}
                          title={`Send SIGTERM to ${proc.name} (PID ${proc.pid})`}
                          className="p-0.5 rounded text-nd-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
                        >
                          <X size={11} />
                        </button>
                        <button
                          onClick={() => handleKillProcess(proc.pid, proc.name, 9)}
                          title={`Force kill (SIGKILL) ${proc.name} (PID ${proc.pid})`}
                          className="p-0.5 rounded text-nd-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
                        >
                          <Skull size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionWrapper>

        {/* ── Services Section ── */}
        {snapshot.services && snapshot.services.length > 0 && (
          <SectionWrapper
            id="services"
            title="Services"
            icon={<Server size={13} />}
            collapsed={collapsedSections.has('services')}
            onToggle={toggleSection}
            headerRight={
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-emerald-400">
                  {snapshot.services.filter(s => s.active === 'active').length} active
                </span>
                {snapshot.services.some(s => s.active === 'failed') && (
                  <span className="text-red-400">
                    {snapshot.services.filter(s => s.active === 'failed').length} failed
                  </span>
                )}
                <CopyButton
                  data={snapshot.services!.map(svc => ({
                    name: svc.name,
                    active: svc.active,
                    sub: svc.sub,
                    description: svc.description
                  }))}
                  label="Services"
                />
              </div>
            }
          >
            <div className="space-y-0.5 max-h-64 overflow-y-auto scrollbar-thin">
              {/* Failed services first */}
              {[...snapshot.services]
                .sort((a, b) => {
                  if (a.active === 'failed' && b.active !== 'failed') return -1
                  if (a.active !== 'failed' && b.active === 'failed') return 1
                  if (a.active === 'active' && b.active !== 'active') return -1
                  if (a.active !== 'active' && b.active === 'active') return 1
                  return a.name.localeCompare(b.name)
                })
                .map(svc => (
                  <div key={svc.name} className={cn(
                    'flex items-center justify-between py-1 px-2 rounded text-xs',
                    svc.active === 'failed' ? 'bg-red-500/8' : 'hover:bg-nd-surface/50'
                  )}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', getStatusDot(svc.active))} />
                      <span className="font-mono text-nd-text-secondary truncate">{svc.name}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={cn('text-[10px] tabular-nums', getStatusColor(svc.sub))}>{svc.sub}</span>
                      <span className="text-[10px] text-nd-text-muted truncate max-w-[200px]">{svc.description}</span>
                    </div>
                  </div>
                ))}
            </div>
          </SectionWrapper>
        )}

        {/* ── Docker Section ── */}
        {snapshot.docker && snapshot.docker.length > 0 && (
          <SectionWrapper
            id="docker"
            title="Docker Containers"
            icon={<Container size={13} />}
            collapsed={collapsedSections.has('docker')}
            onToggle={toggleSection}
            headerRight={
              <div className="flex items-center gap-2">
                <span className="text-xs text-nd-text-muted tabular-nums">
                  {snapshot.docker.length} containers
                </span>
                <CopyButton
                  data={snapshot.docker!.map(c => ({
                    name: c.name,
                    image: c.image,
                    status: c.status,
                    cpuPercent: c.cpuPercent,
                    memory: formatBytes(c.memUsageBytes),
                    memoryLimit: formatBytes(c.memLimitBytes)
                  }))}
                  label="Docker"
                />
              </div>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {snapshot.docker.map(container => (
                <div key={container.id} className="flex items-center gap-3 py-2 px-3 rounded-md bg-nd-bg-primary/50 border border-nd-border/30">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn('w-1.5 h-1.5 rounded-full', container.status === 'running' ? 'bg-emerald-400' : 'bg-nd-text-muted')} />
                      <span className="text-xs font-semibold text-nd-text-secondary truncate">{container.name}</span>
                    </div>
                    <p className="text-[10px] text-nd-text-muted truncate mt-0.5">{container.image}</p>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] tabular-nums shrink-0">
                    <div className="text-right">
                      <div className={getPercentColor(container.cpuPercent)}>{container.cpuPercent.toFixed(1)}%</div>
                      <div className="text-[9px] text-nd-text-muted">CPU</div>
                    </div>
                    <div className="text-right">
                      <div className="text-nd-text-secondary">{formatBytes(container.memUsageBytes)}</div>
                      <div className="text-[9px] text-nd-text-muted">MEM</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionWrapper>
        )}

        {/* ── Temperature + Security Row ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Temperature */}
          {snapshot.temperatures && snapshot.temperatures.length > 0 && (
            <SectionWrapper
              id="temps"
              title="Temperature"
              icon={<Thermometer size={13} />}
              collapsed={collapsedSections.has('temps')}
              onToggle={toggleSection}
            >
              <div className="grid grid-cols-2 gap-2">
                {snapshot.temperatures.map((t, i) => (
                  <div key={i} className="flex items-center justify-between py-1 px-2 rounded bg-nd-bg-primary/50 text-xs">
                    <span className="text-nd-text-muted">{t.label}</span>
                    <span className={cn(
                      'font-mono font-bold tabular-nums',
                      t.celsius < 60 ? 'text-emerald-400' : t.celsius < 80 ? 'text-amber-400' : 'text-red-400'
                    )}>
                      {t.celsius.toFixed(0)}°C
                    </span>
                  </div>
                ))}
              </div>
            </SectionWrapper>
          )}

          {/* Security — span full width when no temperature section */}
          {(snapshot.listeningPorts || snapshot.failedSSHLogins !== undefined || snapshot.activeSessions) && (
            <SectionWrapper
              id="security"
              title="Security"
              icon={<Shield size={13} />}
              collapsed={collapsedSections.has('security')}
              onToggle={toggleSection}
              className={!(snapshot.temperatures && snapshot.temperatures.length > 0) ? 'lg:col-span-2' : undefined}
              headerRight={
                <div className="flex items-center gap-2">
                  {snapshot.failedSSHLogins && snapshot.failedSSHLogins > 0 ? (
                    <span className="text-[10px] text-red-400 font-medium">
                      {snapshot.failedSSHLogins} failed logins (24h)
                    </span>
                  ) : null}
                  <CopyButton
                    data={{
                      failedSSHLogins: snapshot.failedSSHLogins,
                      activeSessions: snapshot.activeSessions,
                      listeningPorts: snapshot.listeningPorts?.map(p => ({
                        address: p.localAddress,
                        protocol: p.protocol,
                        process: p.processName || `PID ${p.pid}`
                      }))
                    }}
                    label="Security"
                  />
                </div>
              }
            >
              <div className="space-y-3">
                {/* Active sessions */}
                {snapshot.activeSessions && snapshot.activeSessions.length > 0 && (
                  <div>
                    <p className="text-[10px] text-nd-text-muted uppercase tracking-wider mb-1">Active Sessions</p>
                    <div className="space-y-0.5">
                      {snapshot.activeSessions.map((s, i) => (
                        <div key={i} className="flex items-center justify-between text-xs py-0.5 px-2 rounded bg-nd-bg-primary/50">
                          <span className="text-nd-text-secondary">{s.user}</span>
                          <span className="text-nd-text-muted font-mono">{s.from}</span>
                          <span className="text-nd-text-muted">{s.loginTime}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Listening ports */}
                {snapshot.listeningPorts && snapshot.listeningPorts.length > 0 && (
                  <div>
                    <p className="text-[10px] text-nd-text-muted uppercase tracking-wider mb-1">
                      Listening Ports ({snapshot.listeningPorts.length})
                    </p>
                    <div className="space-y-0.5 max-h-32 overflow-y-auto scrollbar-thin">
                      {snapshot.listeningPorts.map((port, i) => (
                        <div key={i} className="flex items-center justify-between text-xs py-0.5 px-2 rounded bg-nd-bg-primary/50">
                          <span className="font-mono text-nd-text-secondary">{port.localAddress}</span>
                          <span className="text-nd-text-muted">{port.processName || `PID ${port.pid}`}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </SectionWrapper>
          )}
        </div>

      </div>
    </div>
  )
}

// ── Sortable Table Header ──

type ProcessSortKey = 'pid' | 'name' | 'user' | 'cpuPercent' | 'memPercent' | 'rssBytes'

function SortableHeader({
  column,
  label,
  current,
  direction,
  onSort,
  className
}: {
  column: ProcessSortKey
  label: string
  current: ProcessSortKey
  direction: 'asc' | 'desc'
  onSort: (col: ProcessSortKey) => void
  className?: string
}) {
  const isActive = column === current
  return (
    <th
      className={cn(
        'py-1.5 px-2 cursor-pointer select-none transition-colors hover:text-nd-text-secondary',
        isActive && 'text-nd-text-secondary',
        className
      )}
      onClick={() => onSort(column)}
    >
      <span className={cn('inline-flex items-center gap-1', className?.includes('text-right') && 'justify-end w-full')}>
        {label}
        {isActive
          ? direction === 'asc'
            ? <ArrowUp size={10} className="text-nd-accent" />
            : <ArrowDown size={10} className="text-nd-accent" />
          : <ArrowUpDown size={10} className="opacity-25" />
        }
      </span>
    </th>
  )
}

// ── Copy Button ──

function CopyButton({ data, label }: { data: unknown; label?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
        toast.success('Copied', `${label || 'Data'} copied to clipboard`)
      })
      .catch(() => toast.error('Copy failed', 'Unable to write to clipboard'))
  }, [data, label])

  return (
    <button
      onClick={handleCopy}
      title={`Copy ${label || 'data'} as JSON`}
      className="p-1 rounded text-nd-text-muted hover:text-nd-accent hover:bg-nd-accent/10 transition-colors"
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
    </button>
  )
}

// ── Section Wrapper (collapsible) ──

function SectionWrapper({
  id,
  title,
  icon,
  collapsed,
  onToggle,
  headerRight,
  children,
  className
}: {
  id: string
  title: string
  icon: React.ReactNode
  collapsed: boolean
  onToggle: (id: string) => void
  headerRight?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border border-nd-border/60 bg-nd-bg-secondary/50 overflow-hidden', className)}>
      <button
        onClick={() => onToggle(id)}
        className="flex items-center justify-between w-full px-3 py-2 border-b border-nd-border/40 hover:bg-nd-surface/30 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-nd-text-muted">
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </span>
          <span className="text-nd-text-muted">{icon}</span>
          <h3 className="text-xs font-semibold text-nd-text-secondary uppercase tracking-wider">{title}</h3>
        </div>
        {headerRight && <div onClick={e => e.stopPropagation()}>{headerRight}</div>}
      </button>
      {!collapsed && (
        <div className="p-3">{children}</div>
      )}
    </div>
  )
}

// ── Quick Stat (header bar) ──

function QuickStat({ label, value, max, isLoad }: { label: string; value: number; max?: number; isLoad?: boolean }) {
  let pct: number
  let displayValue: string

  if (isLoad && max) {
    pct = Math.min(100, (value / max) * 100)
    displayValue = value.toFixed(2)
  } else {
    pct = Math.max(0, Math.min(100, value))
    displayValue = `${pct.toFixed(0)}%`
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-nd-text-muted uppercase tracking-wider">{label}</span>
        <span className={cn('text-[11px] font-bold tabular-nums', getPercentColor(pct))}>{displayValue}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <div
          className={cn('h-full rounded-full transition-all duration-500 ease-out', getPercentBg(pct))}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
