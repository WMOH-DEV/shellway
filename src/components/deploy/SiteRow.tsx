import { useRef, type ComponentProps, type MouseEvent, type ReactNode } from 'react'
import { ArrowRight, Copy, Eye, KeyRound, Laptop, Loader2, MoreHorizontal, Pencil, Play, RotateCcw, Server, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/utils/cn'
import type { RemoteDrift, SiteConfig, SiteSummary } from '@/types/deploy'
import { isCheckStale, latestRecord, shortSha, siteBadge, timeAgo, type SiteBadge } from '@/utils/deploy/siteStatus'
import {
  cancelBlockedReason,
  canCancel,
  formatElapsed,
  liveRecord,
  progressView,
  recentRuns,
  rowAction,
  runsCaption,
  shortPath,
  sourceMeta,
  triggerLabel,
  type RowAction
} from '@/utils/deploy/siteRow'
import { BehindChip } from './BehindChip'
import { copyText } from './copyText'
import { RunBars } from './RunBars'
import { SiteStatusBadge } from './SiteStatusBadge'

export interface SiteActions {
  open: (name: string) => void
  deploy: (name: string) => void
  cancel: (name: string) => void
  resume: (name: string) => void
  edit: (name: string) => void
  keySetup: (name: string) => void
}

export const SITE_COLUMNS =
  'grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,2fr)_minmax(0,1.2fr)_132px_168px]'

const URGENT: ReadonlySet<SiteBadge> = new Set(['behind', 'failed', 'never', 'waiting'])

const ACTION_BUTTONS: Record<RowAction, { label: string; icon: ReactNode }> = {
  deploy: { label: 'Deploy', icon: <Play size={13} /> },
  cancel: { label: 'Cancel', icon: <X size={13} /> },
  review: { label: 'Review', icon: <Eye size={13} /> },
  resume: { label: 'Resume', icon: <RotateCcw size={13} /> }
}

const stop = (e: MouseEvent) => e.stopPropagation()

interface SiteCellProps {
  summary: SiteSummary
  pcDrift?: RemoteDrift
  user: string
  onOpen: () => void
}

function SiteCell({ summary, pcDrift, user, onOpen }: SiteCellProps) {
  const { name, path } = summary.config
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={(e) => { stop(e); onOpen() }}
          className="truncate rounded text-left text-sm font-semibold text-nd-text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent"
        >
          {name}
        </button>
        <SiteStatusBadge summary={summary} pcDrift={pcDrift} className="shrink-0" />
      </div>
      <div className="flex min-w-0 items-center gap-1 text-nd-text-muted">
        <Tooltip content={path} triggerClassName="min-w-0">
          <span className="truncate font-mono text-xs">{shortPath(path, user)}</span>
        </Tooltip>
        <button
          type="button"
          aria-label="Copy full path"
          onClick={(e) => { stop(e); copyText(path, 'Path copied') }}
          className="shrink-0 rounded p-1 transition-colors hover:bg-nd-surface-hover hover:text-nd-text-primary"
        >
          <Copy size={12} />
        </button>
      </div>
    </div>
  )
}

function CommitCell({ summary, pcDrift }: { summary: SiteSummary; pcDrift?: RemoteDrift }) {
  const { state } = summary
  if (!state.current) return <div className="text-xs text-nd-text-muted">Nothing live yet</div>
  const live = liveRecord(summary)
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 rounded bg-nd-surface-raised px-1.5 py-px font-mono text-xs text-nd-text-secondary">{shortSha(state.current)}</span>
        <span className="truncate text-[13px] text-nd-text-primary">{state.currentSubject}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2.5 text-xs text-nd-text-muted">
        {live && <span className="truncate">{triggerLabel(live.trigger)} · {timeAgo(live.finished ?? live.started, state.now)}</span>}
        <BehindChip summary={summary} pcDrift={pcDrift} />
      </div>
    </div>
  )
}

function useRunStartMs(summary: SiteSummary): number | null {
  const anchor = useRef<{ id: string; startMs: number } | null>(null)
  const running = latestRecord(summary)
  if (running?.status !== 'running') return null
  if (anchor.current?.id !== running.id) {
    anchor.current = { id: running.id, startMs: Date.now() - (summary.state.now - running.started) * 1000 }
  }
  return anchor.current.startMs
}

function ProgressCell({ summary, nowMs }: { summary: SiteSummary; nowMs: number }) {
  const { state } = summary
  const view = progressView(state.progress)
  const startMs = useRunStartMs(summary)
  const elapsed = startMs === null ? '' : formatElapsed((nowMs - startMs) / 1000)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2 text-[13px]">
        <span className="shrink-0 font-medium text-nd-info-fg">{state.cancelling ? 'Cancelling…' : view.label}</span>
        {view.step && <span className="shrink-0 text-nd-text-muted">{view.step}</span>}
        {view.command && <span className="truncate font-mono text-xs text-nd-text-secondary">{view.command}</span>}
        {elapsed && <span className="ml-auto shrink-0 font-mono text-xs text-nd-text-muted">{elapsed}</span>}
      </div>
      <ProgressBar value={view.fraction * 100} size="sm" trackClassName="h-1" />
    </div>
  )
}

function SourceCell({ config }: { config: SiteConfig }) {
  const auto = config.sourceMode === 'auto'
  const Icon = auto ? Server : Laptop
  return (
    <div className="hidden min-w-0 flex-col gap-1.5 lg:flex">
      <div className="flex min-w-0 items-center gap-2 text-[13px] text-nd-text-secondary">
        <Icon size={14} className="shrink-0 text-nd-text-muted" />
        <span className="truncate">{auto ? 'Auto on server' : 'From my PC'}</span>
      </div>
      <span className="truncate text-xs text-nd-text-muted">{sourceMeta(config)}</span>
    </div>
  )
}

type MenuItems = ComponentProps<typeof Dropdown>['items']

function menuItems(summary: SiteSummary, action: RowAction): MenuItems {
  const items: MenuItems = [
    { id: 'open', label: 'Open', icon: <ArrowRight size={13} /> },
    { id: 'edit', label: 'Edit settings', icon: <Pencil size={13} /> }
  ]
  if (summary.config.sourceMode === 'auto') items.push({ id: 'key', label: 'Deploy key', icon: <KeyRound size={13} /> })
  items.push({ id: 'copy', label: 'Copy full path', icon: <Copy size={13} /> })
  if (isCheckStale(summary) && action !== 'resume') {
    items.push({ id: 'resume', label: 'Resume auto check', icon: <RotateCcw size={13} />, disabled: summary.state.busy })
  }
  return items
}

interface RowActionsProps {
  summary: SiteSummary
  badge: SiteBadge
  starting: boolean
  actions: SiteActions
}

function RowActions({ summary, badge, starting, actions }: RowActionsProps) {
  const { name, path } = summary.config
  const action = rowAction(badge)
  const handlers: Record<RowAction, (site: string) => void> = {
    deploy: actions.deploy,
    cancel: actions.cancel,
    review: actions.open,
    resume: actions.resume
  }
  const menuHandlers: Record<string, () => void> = {
    open: () => actions.open(name),
    edit: () => actions.edit(name),
    key: () => actions.keySetup(name),
    copy: () => copyText(path, 'Path copied'),
    resume: () => actions.resume(name)
  }
  const blocked = action === 'cancel' && !canCancel(summary)
  const { label, icon } = ACTION_BUTTONS[action]
  const button = (
    <Button
      size="sm"
      variant={URGENT.has(badge) ? 'primary' : 'secondary'}
      disabled={starting || blocked}
      onClick={(e) => { stop(e); handlers[action](name) }}
    >
      {starting ? <Loader2 size={13} className="animate-spin" /> : icon}
      {label}
    </Button>
  )
  return (
    <div className="flex items-center justify-end gap-1" onClick={stop}>
      {blocked ? <Tooltip content={cancelBlockedReason(summary)}>{button}</Tooltip> : button}
      <Dropdown
        align="right"
        trigger={<Button size="icon" variant="ghost" aria-label={`More actions for ${name}`}><MoreHorizontal size={15} /></Button>}
        items={menuItems(summary, action)}
        onSelect={(id) => menuHandlers[id]?.()}
      />
    </div>
  )
}

interface SiteRowProps {
  summary: SiteSummary
  pcDrift?: RemoteDrift
  user: string
  nowMs: number
  starting: boolean
  actions: SiteActions
}

export function SiteRow({ summary, pcDrift, user, nowMs, starting, actions }: SiteRowProps) {
  const { config, state } = summary
  const badge = siteBadge(summary, pcDrift)
  const open = () => actions.open(config.name)
  return (
    <div
      onClick={open}
      className={cn(
        'grid cursor-pointer items-center rounded-[10px] border border-nd-border bg-nd-surface px-4 py-3.5 transition-colors hover:border-nd-border-hover hover:bg-nd-surface-hover',
        SITE_COLUMNS
      )}
    >
      <SiteCell summary={summary} pcDrift={pcDrift} user={user} onOpen={open} />
      {state.busy ? <ProgressCell summary={summary} nowMs={nowMs} /> : <CommitCell summary={summary} pcDrift={pcDrift} />}
      <SourceCell config={config} />
      <div className="hidden lg:block"><RunBars runs={recentRuns(summary)} caption={runsCaption(summary)} /></div>
      <RowActions summary={summary} badge={badge} starting={starting} actions={actions} />
    </div>
  )
}
