import { useState, useMemo, useCallback } from 'react'
import {
  X, Play, Square, RotateCw, RefreshCw, ToggleLeft, ToggleRight,
  ChevronDown, ChevronRight, FileText, FolderOpen, Loader2, ScrollText,
  Cpu, MemoryStick, ListTree
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Tooltip } from '@/components/ui/Tooltip'
import { formatBytes } from '@/components/monitor/MonitorCharts'
import type { ServiceDetails, ServiceAction } from '@/types/serviceManager'

interface ServiceDetailPanelProps {
  connectionId: string
  unit: string
  details: ServiceDetails | null
  isLoading: boolean
  actionInProgress: string | null  // "unit:action" format from parent, or null
  onAction: (unit: string, action: ServiceAction) => void
  onClose: () => void
  onViewLogs: () => void
  onOpenConfig: (path: string) => void
}

/** Get badge variant based on active state */
function getStateBadgeVariant(state: string): 'success' | 'error' | 'warning' | 'default' {
  switch (state) {
    case 'active': case 'running': return 'success'
    case 'failed': return 'error'
    case 'activating': case 'deactivating': return 'warning'
    default: return 'default'
  }
}

/** Format nanoseconds to human-readable CPU time */
function formatCpuTime(nsec: number): string {
  const sec = nsec / 1e9
  if (sec < 60) return `${sec.toFixed(2)}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  if (min < 60) return `${min}m ${remSec.toFixed(1)}s`
  const hrs = Math.floor(min / 60)
  const remMin = min % 60
  return `${hrs}h ${remMin}m`
}

/** Calculate human-readable uptime from timestamp string */
function formatUptime(timestamp: string): string {
  if (!timestamp || timestamp === '' || timestamp === '0') return '—'
  const start = new Date(timestamp).getTime()
  if (isNaN(start) || start === 0) return '—'
  const diff = Math.max(0, Math.floor((Date.now() - start) / 1000))
  const d = Math.floor(diff / 86400)
  const h = Math.floor((diff % 86400) / 3600)
  const m = Math.floor((diff % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function ServiceDetailPanel({
  unit,
  details,
  isLoading,
  actionInProgress,
  onAction,
  onClose,
  onViewLogs,
  onOpenConfig
}: ServiceDetailPanelProps) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [confirmAction, setConfirmAction] = useState<ServiceAction | null>(null)

  // Derive pending action from parent's actionInProgress state (no blind timer)
  const pendingAction: ServiceAction | null = actionInProgress?.startsWith(`${unit}:`)
    ? (actionInProgress.split(':')[1] as ServiceAction)
    : null

  // Any action for this unit is in progress — disable all action buttons
  const anyActionPending = pendingAction !== null

  const toggleSection = useCallback((section: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }, [])

  const handleAction = useCallback((action: ServiceAction) => {
    // Confirm destructive actions
    if (action === 'stop' || action === 'disable') {
      setConfirmAction(action)
      return
    }
    onAction(unit, action)
  }, [unit, onAction])

  const handleConfirmAction = useCallback(() => {
    if (!confirmAction) return
    onAction(unit, confirmAction)
    setConfirmAction(null)
  }, [confirmAction, unit, onAction])

  const isRunning = details?.activeState === 'active'
  const isEnabled = details?.unitFileState === 'enabled'

  // Dependencies data
  const deps = useMemo(() => {
    if (!details) return null
    return {
      requires: details.requires ?? [],
      wantedBy: details.wantedBy ?? [],
      after: details.after ?? [],
      before: details.before ?? []
    }
  }, [details])

  const hasDeps = deps && (deps.requires.length > 0 || deps.wantedBy.length > 0 || deps.after.length > 0 || deps.before.length > 0)

  return (
    <div className="h-full flex flex-col bg-nd-bg-secondary border-l border-nd-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-nd-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={14} className="text-nd-accent shrink-0" />
          <h2 className="text-sm font-bold text-nd-text-primary truncate">{unit}</h2>
          {details && (
            <Badge variant={getStateBadgeVariant(details.activeState)}>
              {details.activeState}
            </Badge>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
        {isLoading && !details ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center space-y-2">
              <Loader2 size={20} className="mx-auto text-nd-accent animate-spin" />
              <p className="text-xs text-nd-text-muted">Loading service details...</p>
            </div>
          </div>
        ) : details ? (
          <>
            {/* ── Status Overview ── */}
            <DetailSection
              id="status"
              title="Status"
              collapsed={collapsedSections.has('status')}
              onToggle={toggleSection}
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={getStateBadgeVariant(details.activeState)}>
                    {details.activeState}
                  </Badge>
                  <Badge variant={getStateBadgeVariant(details.subState)}>
                    {details.subState}
                  </Badge>
                  <Badge variant={isEnabled ? 'success' : 'default'}>
                    {details.unitFileState}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  {details.mainPID > 0 && (
                    <div>
                      <span className="text-nd-text-muted">PID</span>
                      <p className="font-mono text-nd-text-secondary tabular-nums">{details.mainPID}</p>
                    </div>
                  )}
                  {details.activeEnterTimestamp && (
                    <div>
                      <span className="text-nd-text-muted">Uptime</span>
                      <p className="font-mono text-nd-text-secondary tabular-nums">{formatUptime(details.activeEnterTimestamp)}</p>
                    </div>
                  )}
                  {details.restartCount !== undefined && details.restartCount > 0 && (
                    <div>
                      <span className="text-nd-text-muted">Restarts</span>
                      <p className="font-mono text-nd-text-secondary tabular-nums">{details.restartCount}</p>
                    </div>
                  )}
                </div>
              </div>
            </DetailSection>

            {/* ── Action Bar ── */}
            <DetailSection
              id="actions"
              title="Actions"
              collapsed={collapsedSections.has('actions')}
              onToggle={toggleSection}
            >
              <div className="space-y-2">
                {/* Start / Stop / Restart / Reload */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {!isRunning && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={anyActionPending}
                      onClick={() => handleAction('start')}
                      className="text-emerald-400 hover:bg-emerald-400/10"
                    >
                      {pendingAction === 'start' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                      Start
                    </Button>
                  )}
                  {isRunning && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={anyActionPending}
                        onClick={() => handleAction('stop')}
                        className="text-red-400 hover:bg-red-400/10"
                      >
                        {pendingAction === 'stop' ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
                        Stop
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={anyActionPending}
                        onClick={() => handleAction('restart')}
                        className="text-orange-400 hover:bg-orange-400/10"
                      >
                        {pendingAction === 'restart' ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
                        Restart
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={anyActionPending}
                        onClick={() => handleAction('reload')}
                        className="text-blue-400 hover:bg-blue-400/10"
                      >
                        {pendingAction === 'reload' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                        Reload
                      </Button>
                    </>
                  )}
                </div>

                {/* Enable / Disable toggle */}
                <div className="flex items-center gap-2 pt-1 border-t border-nd-border/30">
                  <Tooltip content={isEnabled ? 'Disable service on boot' : 'Enable service on boot'} side="right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={anyActionPending}
                      onClick={() => handleAction(isEnabled ? 'disable' : 'enable')}
                      className={cn(
                        isEnabled ? 'text-emerald-400' : 'text-nd-text-muted'
                      )}
                    >
                      {(pendingAction === 'enable' || pendingAction === 'disable')
                        ? <Loader2 size={14} className="animate-spin" />
                        : isEnabled
                          ? <ToggleRight size={14} />
                          : <ToggleLeft size={14} />
                      }
                      {isEnabled ? 'Enabled' : 'Disabled'}
                    </Button>
                  </Tooltip>
                </div>
              </div>
            </DetailSection>

            {/* ── Resource Usage ── */}
            {(details.memoryCurrentBytes !== undefined || details.cpuUsageNSec !== undefined || details.tasksCurrent !== undefined) && (
              <DetailSection
                id="resources"
                title="Resources"
                collapsed={collapsedSections.has('resources')}
                onToggle={toggleSection}
              >
                <div className="grid grid-cols-3 gap-3">
                  {details.memoryCurrentBytes !== undefined && (
                    <div className="flex flex-col items-center gap-1 py-2 px-2 rounded bg-nd-bg-primary/50">
                      <MemoryStick size={12} className="text-purple-400" />
                      <span className="text-xs font-semibold text-nd-text-primary tabular-nums">
                        {formatBytes(details.memoryCurrentBytes)}
                      </span>
                      <span className="text-[10px] text-nd-text-muted uppercase tracking-wider">Memory</span>
                    </div>
                  )}
                  {details.cpuUsageNSec !== undefined && (
                    <div className="flex flex-col items-center gap-1 py-2 px-2 rounded bg-nd-bg-primary/50">
                      <Cpu size={12} className="text-blue-400" />
                      <span className="text-xs font-semibold text-nd-text-primary tabular-nums">
                        {formatCpuTime(details.cpuUsageNSec)}
                      </span>
                      <span className="text-[10px] text-nd-text-muted uppercase tracking-wider">CPU Time</span>
                    </div>
                  )}
                  {details.tasksCurrent !== undefined && (
                    <div className="flex flex-col items-center gap-1 py-2 px-2 rounded bg-nd-bg-primary/50">
                      <ListTree size={12} className="text-cyan-400" />
                      <span className="text-xs font-semibold text-nd-text-primary tabular-nums">
                        {details.tasksCurrent}
                      </span>
                      <span className="text-[10px] text-nd-text-muted uppercase tracking-wider">Tasks</span>
                    </div>
                  )}
                </div>
              </DetailSection>
            )}

            {/* ── Unit File Info ── */}
            <DetailSection
              id="unitfile"
              title="Unit File"
              collapsed={collapsedSections.has('unitfile')}
              onToggle={toggleSection}
            >
              <div className="space-y-2 text-xs">
                {details.type && (
                  <div>
                    <span className="text-nd-text-muted">Type</span>
                    <p className="text-nd-text-secondary">{details.type}</p>
                  </div>
                )}
                {details.fragmentPath && (
                  <div>
                    <span className="text-nd-text-muted">Path</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="font-mono text-nd-text-secondary truncate flex-1" title={details.fragmentPath}>
                        {details.fragmentPath}
                      </p>
                      <Tooltip content="Open in SFTP" side="left">
                        <button
                          onClick={() => onOpenConfig(details.fragmentPath)}
                          className="p-1 rounded text-nd-text-muted hover:text-nd-accent hover:bg-nd-accent/10 transition-colors shrink-0"
                        >
                          <FolderOpen size={12} />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                )}
                {details.description && (
                  <div>
                    <span className="text-nd-text-muted">Description</span>
                    <p className="text-nd-text-secondary">{details.description}</p>
                  </div>
                )}
              </div>
            </DetailSection>

            {/* ── Dependencies ── */}
            {hasDeps && (
              <DetailSection
                id="dependencies"
                title="Dependencies"
                collapsed={collapsedSections.has('dependencies')}
                onToggle={toggleSection}
                defaultCollapsed
              >
                <div className="space-y-3 text-xs">
                  <DepList label="Requires" items={deps.requires} />
                  <DepList label="WantedBy" items={deps.wantedBy} />
                  <DepList label="After" items={deps.after} />
                  <DepList label="Before" items={deps.before} />
                </div>
              </DetailSection>
            )}

            {/* ── View Logs ── */}
            <Button
              variant="outline"
              size="sm"
              onClick={onViewLogs}
              className="w-full"
            >
              <ScrollText size={13} />
              View Journal Logs
            </Button>
          </>
        ) : (
          <div className="flex items-center justify-center py-12">
            <p className="text-xs text-nd-text-muted">No details available</p>
          </div>
        )}
      </div>

      {/* ── Confirmation Modal ── */}
      <Modal
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        title={`Confirm ${confirmAction}`}
        maxWidth="max-w-sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-nd-text-secondary">
            Are you sure you want to <span className="font-semibold text-nd-text-primary">{confirmAction}</span> the service{' '}
            <span className="font-mono text-nd-text-primary">{unit}</span>?
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              variant={confirmAction === 'stop' ? 'danger' : 'primary'}
              size="sm"
              onClick={handleConfirmAction}
            >
              {confirmAction === 'stop' ? 'Stop Service' : 'Disable Service'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ── Collapsible Detail Section ──

function DetailSection({
  id,
  title,
  collapsed,
  onToggle,
  children,
  defaultCollapsed: _defaultCollapsed
}: {
  id: string
  title: string
  collapsed: boolean
  onToggle: (id: string) => void
  children: React.ReactNode
  defaultCollapsed?: boolean
}) {
  return (
    <div className="rounded-lg border border-nd-border/60 bg-nd-bg-secondary/50 overflow-hidden">
      <button
        onClick={() => onToggle(id)}
        className="flex items-center gap-1.5 w-full px-3 py-2 border-b border-nd-border/40 hover:bg-nd-surface/30 transition-colors"
      >
        <span className="text-nd-text-muted">
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </span>
        <h3 className="text-xs font-semibold text-nd-text-secondary uppercase tracking-wider">{title}</h3>
      </button>
      {!collapsed && (
        <div className="p-3">{children}</div>
      )}
    </div>
  )
}

// ── Dependency List ──

function DepList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <span className="text-[10px] text-nd-text-muted uppercase tracking-wider">{label}</span>
      {items.length === 0 ? (
        <p className="text-nd-text-muted italic">(none)</p>
      ) : (
        <div className="flex flex-wrap gap-1 mt-1">
          {items.map(item => (
            <span
              key={item}
              className="inline-block px-1.5 py-0.5 rounded bg-nd-surface text-[11px] font-mono text-nd-text-secondary border border-nd-border/40"
            >
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
