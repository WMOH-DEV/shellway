import { ArrowRightLeft, Copy, ExternalLink, Globe, Pencil, Play, Square, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import type { PortForwardRule } from '@/types/session'
import type { PortForwardEntry } from '@/types/portForward'
import { formatTraffic, routeText, ruleTitle } from './portForwardRules'

export type RuleState = 'active' | 'waiting' | 'error' | 'stopped'

export function ruleState(entry: PortForwardEntry | undefined, connected: boolean): RuleState {
  if (!entry) return 'stopped'
  if (entry.status === 'error') return 'error'
  return connected ? 'active' : 'waiting'
}

const STATE_BADGES: Record<RuleState, { label: string; variant: 'success' | 'warning' | 'error' | 'default'; dot: string }> = {
  active: { label: 'Active', variant: 'success', dot: 'bg-nd-success' },
  waiting: { label: 'Waiting for connection', variant: 'warning', dot: 'bg-nd-warning' },
  error: { label: 'Failed', variant: 'error', dot: 'bg-nd-error' },
  stopped: { label: 'Stopped', variant: 'default', dot: 'bg-nd-text-muted' }
}

interface RuleRowProps {
  rule: PortForwardRule
  entry: PortForwardEntry | undefined
  connected: boolean
  selected: boolean
  onSelect: (selected: boolean) => void
  onStart: () => void
  onStop: () => void
  onEdit: () => void
  onDelete: () => void
  onCopy: () => void
  onOpen: () => void
}

function TypeIcon({ rule }: { rule: PortForwardRule }) {
  if (rule.type === 'dynamic') return <Globe size={14} className="shrink-0 text-nd-warning" />
  return <ArrowRightLeft size={14} className={cn('shrink-0', rule.type === 'remote' ? 'rotate-180 text-nd-success' : 'text-nd-accent')} />
}

function Details({ entry, state }: { entry: PortForwardEntry | undefined; state: RuleState }) {
  if (state === 'error') return <p className="mt-1 text-2xs text-nd-error-fg">{entry?.error}</p>
  if (state !== 'active' || !entry) return null
  const connections = entry.openConnections === 1 ? '1 open connection' : `${entry.openConnections} open connections`
  return (
    <>
      <p className="mt-1 text-2xs text-nd-text-muted">
        {connections} · {formatTraffic(entry.bytes)} transferred
      </p>
      {entry.lastError && <p className="mt-0.5 text-2xs text-nd-warning-fg">Last problem: {entry.lastError}</p>}
    </>
  )
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      {children}
    </Button>
  )
}

export function RuleRow({ rule, entry, connected, selected, onSelect, onStart, onStop, onEdit, onDelete, onCopy, onOpen }: RuleRowProps) {
  const state = ruleState(entry, connected)
  const badge = STATE_BADGES[state]
  const running = state === 'active' || state === 'waiting'
  const title = ruleTitle(rule)

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-nd-bg-secondary p-3',
        selected ? 'border-nd-accent/60' : 'border-nd-border'
      )}
    >
      <input
        type="checkbox"
        className="h-3.5 w-3.5 shrink-0 accent-nd-accent"
        checked={selected}
        onChange={(event) => onSelect(event.target.checked)}
        aria-label={`Select ${title}`}
      />
      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', badge.dot)} />
      <TypeIcon rule={rule} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-nd-text-primary">{title}</span>
          <Badge variant={badge.variant}>{badge.label}</Badge>
          {rule.autoStart && <Badge>Starts on connect</Badge>}
        </div>
        <p className="mt-0.5 truncate font-mono text-2xs text-nd-text-muted" title={routeText(rule)}>
          {routeText(rule)}
        </p>
        <Details entry={entry} state={state} />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {rule.type !== 'remote' && (
          <IconButton label="Copy address" onClick={onCopy}>
            <Copy size={13} />
          </IconButton>
        )}
        {rule.type === 'local' && state === 'active' && (
          <IconButton label="Open in browser" onClick={onOpen}>
            <ExternalLink size={13} />
          </IconButton>
        )}
        {running ? (
          <IconButton label={`Stop ${title}`} onClick={onStop}>
            <Square size={13} />
          </IconButton>
        ) : (
          <IconButton label={`Start ${title}`} onClick={onStart} disabled={!connected}>
            <Play size={13} />
          </IconButton>
        )}
        <IconButton label={`Edit ${title}`} onClick={onEdit}>
          <Pencil size={13} />
        </IconButton>
        <IconButton label={`Delete ${title}`} onClick={onDelete}>
          <Trash2 size={13} />
        </IconButton>
      </div>
    </div>
  )
}
