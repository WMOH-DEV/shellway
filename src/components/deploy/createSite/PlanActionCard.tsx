import { useState } from 'react'
import { Activity, ChevronDown, ChevronRight, Cloud, Code, Cpu, Folder, LayoutGrid, Lock, Package, Play, RefreshCw, Server, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { PlanAction, PlanActionId, PlanChip } from '@/types/createSite'
import { cn } from '@/utils/cn'
import { RecordRows } from './RecordRows'

interface PlanActionCardProps {
  action: PlanAction
  index: number
  onEdit: () => void
}

const ICONS: Record<PlanActionId, LucideIcon> = {
  php: Code,
  composer: Package,
  pm2: RefreshCw,
  folder: Folder,
  pool: Cpu,
  modules: LayoutGrid,
  site: Server,
  dns: Cloud,
  https: Lock,
  deploys: Play,
  'first-deploy': Activity
}

function chipTone(chip: PlanChip): string {
  if (chip === 'ready') return 'bg-nd-success/12 text-nd-success-fg'
  if (chip === 'needs you' || chip === 'installs') return 'bg-nd-warning/12 text-nd-warning-fg'
  if (chip === 'blocked') return 'bg-nd-error/12 text-nd-error-fg'
  return 'bg-nd-accent/12 text-nd-accent-hover'
}

export function PlanChipLabel({ chip }: { chip: PlanChip }) {
  return <span className={cn('whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium', chipTone(chip))}>{chip}</span>
}

const CALLOUT_TONE: Partial<Record<PlanChip, string>> = {
  'needs you': 'border-nd-warning/25 bg-nd-warning/[0.07]',
  blocked: 'border-nd-error/25 bg-nd-error/[0.07]'
}

const CARD_BORDER: Partial<Record<PlanChip, string>> = {
  'needs you': 'border-nd-warning/35',
  blocked: 'border-nd-error/35'
}

const hasDetails = ({ commands, script, config, records }: PlanAction): boolean =>
  commands.length > 0 || script !== null || config !== null || records.length > 0

const CODE_BOX = 'max-h-72 overflow-auto whitespace-pre rounded-lg border border-nd-border bg-nd-bg-sunken px-3 py-2 font-mono text-xs leading-relaxed text-nd-text-secondary'

function ActionDetails({ action }: { action: PlanAction }) {
  return (
    <div className="flex flex-col gap-2.5 border-t border-nd-border px-4 py-3">
      {action.note !== '' && CALLOUT_TONE[action.chip] === undefined && <span className="text-xs text-nd-text-muted">{action.note}</span>}
      {action.commands.length > 0 && <pre aria-label="Commands" className={CODE_BOX}>{action.commands.map((command) => `$ ${command}`).join('\n')}</pre>}
      {action.script !== null && <pre aria-label="Script" className={CODE_BOX}>{action.script}</pre>}
      {action.config !== null && <pre aria-label="Config" className={CODE_BOX}>{action.config}</pre>}
      {action.records.length > 0 && <RecordRows records={action.records} />}
    </div>
  )
}

export function PlanActionCard({ action, index, onEdit }: PlanActionCardProps) {
  const [open, setOpen] = useState(false)
  const Icon = ICONS[action.id]
  const callout = CALLOUT_TONE[action.chip]
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <section aria-label={action.title} className={cn('overflow-hidden rounded-[10px] border bg-nd-surface', CARD_BORDER[action.chip] ?? 'border-nd-border')}>
      <div className="grid grid-cols-[20px_32px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
        <span className="text-right font-mono text-[11px] text-nd-text-muted">{index + 1}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-nd-surface-raised text-nd-accent"><Icon size={15} aria-hidden /></span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-semibold text-nd-text-primary">{action.title}</span>
          <span className="truncate text-xs text-nd-text-muted" title={action.summary}>{action.summary}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <PlanChipLabel chip={action.chip} />
          <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
          {hasDetails(action) && (
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={open ? 'Hide details' : 'Show details'} aria-expanded={open} onClick={() => setOpen(!open)}>
              <Chevron size={14} />
            </Button>
          )}
        </div>
      </div>
      {callout !== undefined && action.note !== '' && (
        <div className={cn('border-t px-4 py-2.5 text-xs text-nd-text-primary', callout)}>{action.note}</div>
      )}
      {open && <ActionDetails action={action} />}
    </section>
  )
}
