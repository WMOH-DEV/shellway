import { forwardRef, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { Toggle } from '@/components/ui/Toggle'
import { cn } from '@/utils/cn'
import { formatBytes, formatCpu } from '@/utils/server/services/format'
import { primaryVerb, type ControlVerb, type ServiceItem } from '@/utils/server/services/list'
import type { ServiceState } from '@/utils/server/services/types'
import { Chip, StatusDot, type KitTone } from '../../kit'

export const ROW_GRID = 'grid grid-cols-[22px_minmax(0,1.4fr)_100px_130px_70px_80px_90px_190px] items-center gap-3.5 px-4'

const KIND_LABEL: Record<ServiceItem['kind'], string> = { systemd: 'systemd', supervisor: 'supervisor', pm2: 'pm2', container: 'container' }

const STATE_TONE: Record<ServiceState, KitTone> = { running: 'success', starting: 'info', stopped: 'neutral', failed: 'error' }

const STATE_TEXT: Record<ServiceState, string> = { running: 'text-nd-text-secondary', starting: 'text-nd-info-fg', stopped: 'text-nd-text-muted', failed: 'text-nd-error-fg' }

export const VERB_LABEL: Record<ControlVerb, string> = { start: 'Start', stop: 'Stop', restart: 'Restart', reload: 'Reload', enable: 'Start on boot', disable: 'Do not start on boot', 'reset-failed': 'Clear' }

const CLEAR_TITLE = 'This runs once, at boot. Clear removes the failed mark without running it again.'

const RUN_VERBS: readonly ControlVerb[] = ['reset-failed', 'start', 'reload', 'restart', 'stop']

interface ServiceRowProps {
  item: ServiceItem
  detail: string
  open: boolean
  highlighted: boolean
  onToggleOpen(): void
  onVerb(verb: ControlVerb): void
  onLogs(): void
  children?: ReactNode
}

function BootCell({ item, onVerb }: Pick<ServiceRowProps, 'item' | 'onVerb'>) {
  if (item.onBoot === null) return <span className="text-xs text-nd-text-muted">—</span>
  if (item.kind !== 'systemd') return <span className="text-xs text-nd-text-muted">{item.onBoot ? 'Yes' : 'No'}</span>
  return <Toggle checked={item.onBoot} ariaLabel={`Start ${item.name} on boot`} onChange={(checked) => onVerb(checked ? 'enable' : 'disable')} />
}

function ActionsCell({ item, onVerb, onLogs }: Pick<ServiceRowProps, 'item' | 'onVerb' | 'onLogs'>) {
  const primary = primaryVerb(item)
  const others = RUN_VERBS.filter((verb) => verb !== primary && item.verbs.includes(verb))
  return (
    <span className="flex items-center justify-end gap-1">
      <Button size="sm" variant={item.state === 'failed' ? 'primary' : 'secondary'} title={primary === 'reset-failed' ? CLEAR_TITLE : undefined} onClick={() => onVerb(primary)}>{VERB_LABEL[primary]}</Button>
      <Button size="sm" variant="secondary" onClick={onLogs}>Logs</Button>
      {others.length > 0 ? (
        <Dropdown
          align="right"
          trigger={<Button size="sm" variant="ghost" aria-label={`More actions for ${item.name}`} className="w-7 px-0"><MoreHorizontal size={14} /></Button>}
          items={others.map((verb) => ({ id: verb, label: VERB_LABEL[verb], danger: verb === 'stop' }))}
          onSelect={(verb) => onVerb(verb as ControlVerb)}
        />
      ) : (
        <span className="w-7" />
      )}
    </span>
  )
}

export const ServiceRow = forwardRef<HTMLDivElement, ServiceRowProps>(function ServiceRow({ item, detail, open, highlighted, onToggleOpen, onVerb, onLogs, children }, ref) {
  const expandable = item.state === 'failed'
  return (
    <div ref={ref} className={cn('border-b border-nd-border last:border-b-0', open && 'bg-nd-error/[0.05]', highlighted && !open && 'bg-nd-surface-raised')}>
      <div className={cn(ROW_GRID, 'py-2.5')}>
        {expandable ? (
          <button type="button" aria-expanded={open} aria-label={open ? `Hide details for ${item.name}` : `Show details for ${item.name}`} onClick={onToggleOpen} className="text-nd-text-muted hover:text-nd-text-primary">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <StatusDot tone={STATE_TONE[item.state]} label={item.state} />
        )}
        <span className="flex min-w-0 flex-col gap-px">
          <span className="truncate font-mono text-[12.5px] text-nd-text-primary">{item.name}</span>
          {detail && <span className="truncate text-xs text-nd-text-muted">{detail}</span>}
        </span>
        <span><Chip dense>{KIND_LABEL[item.kind]}</Chip></span>
        <span className={cn('truncate text-[12.5px]', STATE_TEXT[item.state])}>{item.statusText}</span>
        <span className="font-mono text-xs text-nd-text-muted">{formatCpu(item.cpuPercent)}</span>
        <span className="font-mono text-xs text-nd-text-muted">{formatBytes(item.memoryBytes)}</span>
        <BootCell item={item} onVerb={onVerb} />
        <ActionsCell item={item} onVerb={onVerb} onLogs={onLogs} />
      </div>
      {open && children}
    </div>
  )
})
