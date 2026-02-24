import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import {
  RefreshCw, Search, X, AlertTriangle, Cog
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import { toast } from '@/components/ui/Toast'
import { useServiceManagerStore } from '@/stores/serviceManagerStore'
import { ServiceList } from './ServiceList'
import { ServiceDetailPanel } from './ServiceDetailPanel'
import { ServiceLogViewer } from './ServiceLogViewer'
import type { ConnectionStatus } from '@/types/session'
import type { ServiceAction, ServiceFilter } from '@/types/serviceManager'

interface ServiceManagerViewProps {
  connectionId: string
  sessionId: string
  connectionStatus: ConnectionStatus
}

const DEFAULT_FILTER: ServiceFilter = {
  search: '',
  activeFilter: 'all',
  loadFilter: 'all',
  sortBy: 'name',
  sortDir: 'asc'
}

const STORAGE_KEY_PANEL_WIDTH = 'shellway:services:panelWidth'
const DEFAULT_PANEL_WIDTH = 420
const MIN_PANEL_WIDTH = 280
const MAX_PANEL_WIDTH = 800

/**
 * Main Service Manager view — manages systemd services on the remote server.
 *
 * Layout:
 *   - Toolbar (search, filters, refresh)
 *   - Service list (left) + Detail panel (right, when service selected)
 *   - Log viewer (bottom, when viewing logs)
 */
export function ServiceManagerView({ connectionId, connectionStatus }: ServiceManagerViewProps) {
  const {
    services: servicesMap,
    details: detailsMap,
    logs: logsMap,
    status: statusMap,
    errors: errorsMap,
    selectedUnit: selectedUnitMap,
    filter: filterMap,
    setServices,
    setDetails,
    setLogs,
    setStatus,
    setError,
    setSelectedUnit,
    setFilter
  } = useServiceManagerStore()

  const services = servicesMap.get(connectionId) ?? []
  const details = detailsMap.get(connectionId) ?? null
  const logs = logsMap.get(connectionId) ?? []
  const managerStatus = statusMap.get(connectionId) ?? 'idle'
  const errorMsg = errorsMap.get(connectionId) ?? null
  const selectedUnit = selectedUnitMap.get(connectionId) ?? null
  const filter = filterMap.get(connectionId) ?? DEFAULT_FILTER

  const [showLogs, setShowLogs] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const isMountedRef = useRef(true)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const connectionStatusRef = useRef(connectionStatus)

  // ── Resizable right panel ──
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_PANEL_WIDTH)
      if (stored) {
        const parsed = Number(stored)
        if (parsed >= MIN_PANEL_WIDTH && parsed <= MAX_PANEL_WIDTH) return parsed
      }
    } catch { /* localStorage unavailable */ }
    return DEFAULT_PANEL_WIDTH
  })
  const isDraggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(DEFAULT_PANEL_WIDTH)
  const panelWidthRef = useRef(panelWidth)

  // Keep ref in sync for mouseup handler
  useEffect(() => { panelWidthRef.current = panelWidth }, [panelWidth])

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    isDraggingRef.current = true
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = panelWidthRef.current
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      // Panel is on the right, so dragging left increases width
      const delta = dragStartXRef.current - e.clientX
      const newWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, dragStartWidthRef.current + delta))
      setPanelWidth(newWidth)
    }

    const handleMouseUp = () => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      // Persist to localStorage on drag end (use ref for latest value)
      try {
        localStorage.setItem(STORAGE_KEY_PANEL_WIDTH, String(panelWidthRef.current))
      } catch { /* localStorage unavailable */ }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  // Keep connectionStatus ref current to avoid stale closures in timers
  useEffect(() => {
    connectionStatusRef.current = connectionStatus
  }, [connectionStatus])

  // ── Probe + Load services on mount ──
  useEffect(() => {
    isMountedRef.current = true

    if (connectionStatus !== 'connected') return

    const init = async () => {
      setStatus(connectionId, 'loading')

      try {
        // Probe for systemd
        const probeResult = await window.novadeck.services.probe(connectionId)
        if (!isMountedRef.current) return

        if (!probeResult.success) {
          setStatus(connectionId, 'unsupported')
          setError(connectionId, probeResult.error ?? 'systemd not detected on this server')
          return
        }

        // Load service list
        await loadServices()
      } catch (err) {
        if (isMountedRef.current) {
          setStatus(connectionId, 'error')
          setError(connectionId, String(err))
        }
      }
    }

    init()

    // Auto-refresh every 30s (uses ref to avoid stale closure)
    pollTimerRef.current = setInterval(() => {
      if (isMountedRef.current && connectionStatusRef.current === 'connected') {
        loadServices(true) // silent refresh
      }
    }, 30000)

    return () => {
      isMountedRef.current = false
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, connectionStatus])

  // ── Load services ──
  const loadServices = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true)

    try {
      const result = await window.novadeck.services.list(connectionId)
      if (!isMountedRef.current) return

      if (result.success && result.data) {
        setServices(connectionId, result.data as typeof services)
        setStatus(connectionId, 'active')
        setError(connectionId, null)
      } else {
        if (!silent) {
          setError(connectionId, result.error ?? 'Failed to list services')
        }
      }
    } catch (err) {
      if (isMountedRef.current && !silent) {
        setError(connectionId, String(err))
      }
    } finally {
      if (isMountedRef.current) setIsRefreshing(false)
    }
  }, [connectionId, setServices, setStatus, setError])

  // ── Load service details ──
  const loadDetails = useCallback(async (unit: string) => {
    setLoadingDetails(true)
    try {
      const result = await window.novadeck.services.details(connectionId, unit)
      if (!isMountedRef.current) return

      if (result.success && result.data) {
        setDetails(connectionId, result.data as typeof details)
      } else {
        toast.error('Failed to load details', result.error ?? 'Unknown error')
      }
    } catch (err) {
      toast.error('Failed to load details', String(err))
    } finally {
      if (isMountedRef.current) setLoadingDetails(false)
    }
  }, [connectionId, setDetails])

  // ── Load service logs ──
  const loadLogs = useCallback(async (lines: number = 100) => {
    if (!selectedUnit) return
    setLoadingLogs(true)

    try {
      const result = await window.novadeck.services.logs(connectionId, selectedUnit, lines)
      if (!isMountedRef.current) return

      if (result.success && result.data) {
        setLogs(connectionId, result.data as typeof logs)
      } else {
        toast.error('Failed to load logs', result.error ?? 'Unknown error')
      }
    } catch (err) {
      toast.error('Failed to load logs', String(err))
    } finally {
      if (isMountedRef.current) setLoadingLogs(false)
    }
  }, [connectionId, selectedUnit, setLogs])

  // ── Perform service action ──
  const handleAction = useCallback(async (unit: string, action: ServiceAction) => {
    setActionInProgress(`${unit}:${action}`)

    try {
      const result = await window.novadeck.services.action(connectionId, unit, action)

      if (result.success) {
        toast.success(
          `${action.charAt(0).toUpperCase() + action.slice(1)} successful`,
          `${unit}`
        )
        // Refresh service list + details after action
        await loadServices(true)
        if (selectedUnit === unit) {
          await loadDetails(unit)
        }
      } else {
        toast.error(
          `${action.charAt(0).toUpperCase() + action.slice(1)} failed`,
          result.error ?? 'Unknown error'
        )
      }
    } catch (err) {
      toast.error('Action failed', String(err))
    } finally {
      if (isMountedRef.current) setActionInProgress(null)
    }
  }, [connectionId, selectedUnit, loadServices, loadDetails])

  // ── Select a service ──
  const handleSelectUnit = useCallback((unit: string) => {
    setSelectedUnit(connectionId, unit)
    setShowLogs(false)
    loadDetails(unit)
  }, [connectionId, setSelectedUnit, loadDetails])

  // ── Close detail panel ──
  const handleCloseDetail = useCallback(() => {
    setSelectedUnit(connectionId, null)
    setDetails(connectionId, null)
    setShowLogs(false)
  }, [connectionId, setSelectedUnit, setDetails])

  // ── View logs ──
  const handleViewLogs = useCallback(() => {
    setShowLogs(true)
    loadLogs(100)
  }, [loadLogs])

  // ── Close logs ──
  const handleCloseLogs = useCallback(() => {
    setShowLogs(false)
    setLogs(connectionId, [])
  }, [connectionId, setLogs])

  // ── Open config in SFTP ──
  const handleOpenConfig = useCallback((path: string) => {
    toast.info('Config path', path)
    // TODO: In the future, integrate with SFTP editor to open the file directly
  }, [])

  // ── Filter services ──
  const filteredServices = useMemo(() => {
    let filtered = [...services]

    // Search filter
    if (filter.search) {
      const search = filter.search.toLowerCase()
      filtered = filtered.filter(s =>
        s.unit.toLowerCase().includes(search) ||
        s.description.toLowerCase().includes(search)
      )
    }

    // Active filter
    if (filter.activeFilter !== 'all') {
      filtered = filtered.filter(s => s.active === filter.activeFilter)
    }

    // Load filter
    if (filter.loadFilter !== 'all') {
      filtered = filtered.filter(s => s.load === filter.loadFilter)
    }

    return filtered
  }, [services, filter])

  // ── Counts for filter badges ──
  const counts = useMemo(() => ({
    total: services.length,
    active: services.filter(s => s.active === 'active').length,
    inactive: services.filter(s => s.active === 'inactive').length,
    failed: services.filter(s => s.active === 'failed').length,
    filtered: filteredServices.length
  }), [services, filteredServices])

  // ── Manual refresh ──
  const handleRefresh = useCallback(() => {
    loadServices()
  }, [loadServices])

  // ── Not connected state ──
  if (connectionStatus !== 'connected') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <Cog size={40} className="mx-auto text-nd-text-muted opacity-30" />
          <p className="text-sm text-nd-text-muted">Connect to manage services</p>
        </div>
      </div>
    )
  }

  // ── Unsupported state ──
  if (managerStatus === 'unsupported') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3 max-w-sm">
          <AlertTriangle size={40} className="mx-auto text-nd-warning opacity-50" />
          <p className="text-sm text-nd-text-secondary font-medium">systemd not available</p>
          <p className="text-xs text-nd-text-muted">
            {errorMsg ?? 'This server does not appear to use systemd. The Service Manager requires systemd to function.'}
          </p>
        </div>
      </div>
    )
  }

  // ── Loading state ──
  if (managerStatus === 'loading' && services.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <RefreshCw size={24} className="mx-auto text-nd-accent animate-spin" />
          <p className="text-sm text-nd-text-muted">Loading services...</p>
          <p className="text-xs text-nd-text-muted/60">Querying systemd on the remote server</p>
        </div>
      </div>
    )
  }

  // ── Error state (no services loaded) ──
  if (managerStatus === 'error' && services.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3 max-w-sm">
          <AlertTriangle size={40} className="mx-auto text-nd-error opacity-50" />
          <p className="text-sm text-nd-text-secondary font-medium">Failed to load services</p>
          <p className="text-xs text-nd-text-muted">{errorMsg}</p>
          <Button size="sm" variant="secondary" onClick={handleRefresh}>
            <RefreshCw size={14} />
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ── */}
      <div className="shrink-0 px-3 py-2 bg-nd-bg-secondary border-b border-nd-border flex items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nd-text-muted" />
          <input
            type="text"
            placeholder="Search services..."
            value={filter.search}
            onChange={(e) => setFilter(connectionId, { search: e.target.value })}
            className="w-full pl-8 pr-8 py-1.5 text-xs bg-nd-bg-primary border border-nd-border rounded-md text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent/50 focus:ring-1 focus:ring-nd-accent/30"
          />
          {filter.search && (
            <button
              onClick={() => setFilter(connectionId, { search: '' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-nd-text-muted hover:text-nd-text-secondary"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Active filter pills */}
        <div className="flex items-center gap-1">
          <FilterPill
            label="All"
            count={counts.total}
            active={filter.activeFilter === 'all'}
            onClick={() => setFilter(connectionId, { activeFilter: 'all' })}
          />
          <FilterPill
            label="Active"
            count={counts.active}
            active={filter.activeFilter === 'active'}
            onClick={() => setFilter(connectionId, { activeFilter: 'active' })}
            color="emerald"
          />
          <FilterPill
            label="Inactive"
            count={counts.inactive}
            active={filter.activeFilter === 'inactive'}
            onClick={() => setFilter(connectionId, { activeFilter: 'inactive' })}
          />
          <FilterPill
            label="Failed"
            count={counts.failed}
            active={filter.activeFilter === 'failed'}
            onClick={() => setFilter(connectionId, { activeFilter: 'failed' })}
            color="red"
          />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Service count */}
        <span className="text-2xs text-nd-text-muted">
          {counts.filtered === counts.total
            ? `${counts.total} services`
            : `${counts.filtered} / ${counts.total} services`
          }
        </span>

        {/* Refresh button */}
        <Button
          size="icon"
          variant="ghost"
          onClick={handleRefresh}
          disabled={isRefreshing}
          title="Refresh services"
        >
          <RefreshCw size={14} className={cn(isRefreshing && 'animate-spin')} />
        </Button>
      </div>

      {/* ── Main content: list + detail panel ── */}
      <div className="flex-1 overflow-hidden flex">
        {/* Service list */}
        <div className="flex-1 overflow-y-auto min-w-0">
          <ServiceList
            connectionId={connectionId}
            services={filteredServices}
            selectedUnit={selectedUnit}
            onSelectUnit={handleSelectUnit}
            onAction={handleAction}
            isLoading={isRefreshing}
          />
        </div>

        {/* Drag handle + Detail panel / Log viewer (when service selected) */}
        {selectedUnit && (
          <>
            {/* Drag handle */}
            <div
              onMouseDown={handleDragStart}
              className="shrink-0 w-px bg-nd-border hover:bg-nd-accent cursor-col-resize transition-colors duration-150 hover:w-0.5 relative group z-10"
              title="Drag to resize"
            >
              {/* Wider invisible hit target for easier grabbing */}
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </div>

            {/* Panel: detail or logs */}
            {!showLogs ? (
              <div
                className="shrink-0 overflow-y-auto bg-nd-bg-secondary"
                style={{ width: panelWidth }}
              >
                <ServiceDetailPanel
                  connectionId={connectionId}
                  unit={selectedUnit}
                  details={details}
                  isLoading={loadingDetails}
                  actionInProgress={actionInProgress}
                  onAction={handleAction}
                  onClose={handleCloseDetail}
                  onViewLogs={handleViewLogs}
                  onOpenConfig={handleOpenConfig}
                />
              </div>
            ) : (
              <div
                className="shrink-0 overflow-hidden bg-nd-bg-primary"
                style={{ width: panelWidth }}
              >
                <ServiceLogViewer
                  connectionId={connectionId}
                  unit={selectedUnit}
                  logs={logs}
                  isLoading={loadingLogs}
                  onLoadLogs={loadLogs}
                  onClose={handleCloseLogs}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Status bar ── */}
      <div className="shrink-0 px-3 py-1 bg-nd-bg-secondary border-t border-nd-border flex items-center gap-2">
        <div className={cn(
          'w-1.5 h-1.5 rounded-full',
          managerStatus === 'active' ? 'bg-emerald-400' :
          managerStatus === 'error' ? 'bg-red-400' :
          managerStatus === 'loading' ? 'bg-amber-400 animate-pulse' :
          'bg-nd-text-muted'
        )} />
        <span className="text-2xs text-nd-text-muted">
          {managerStatus === 'active' ? 'Connected · Auto-refresh every 30s' :
           managerStatus === 'loading' ? 'Loading...' :
           managerStatus === 'error' ? (errorMsg ?? 'Error') :
           'Idle'}
        </span>
        {actionInProgress && (
          <span className="text-2xs text-nd-accent flex items-center gap-1">
            <RefreshCw size={10} className="animate-spin" />
            {actionInProgress.split(':')[1]}...
          </span>
        )}
      </div>
    </div>
  )
}

// ── Filter Pill ──

interface FilterPillProps {
  label: string
  count: number
  active: boolean
  onClick: () => void
  color?: 'emerald' | 'red'
}

function FilterPill({ label, count, active, onClick, color }: FilterPillProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium transition-colors',
        active
          ? 'bg-nd-accent/15 text-nd-accent'
          : 'text-nd-text-muted hover:text-nd-text-secondary hover:bg-nd-surface'
      )}
    >
      {color && (
        <span className={cn(
          'w-1.5 h-1.5 rounded-full',
          color === 'emerald' ? 'bg-emerald-400' : 'bg-red-400'
        )} />
      )}
      {label}
      <span className="opacity-60">{count}</span>
    </button>
  )
}
