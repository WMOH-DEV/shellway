import { ArrowLeft, Check, ChevronDown, KeyRound, Loader2, MoreHorizontal, Play, RotateCcw, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { Tooltip } from '@/components/ui/Tooltip'
import type { DeployRecord, RemoteDrift, SiteSummary } from '@/types/deploy'
import { shortSha } from '@/utils/deploy/siteStatus'
import { canCancel, cancelBlockedReason } from '@/utils/deploy/siteRow'
import { deployLabel } from '@/utils/deploy/siteDetail'
import { BehindChip } from '../BehindChip'
import { SiteStatusBadge } from '../SiteStatusBadge'

export interface DetailActions {
  back: () => void
  deploy: () => void
  deployNow: () => void
  approve: () => void
  cancel: () => void
  rollback: (record: DeployRecord) => void
  keySetup: () => void
  remove: () => void
}

interface DetailHeaderProps {
  summary: SiteSummary
  pcDrift?: RemoteDrift
  starting: boolean
  rollbackTo: DeployRecord | undefined
  actions: DetailActions
}

function CancelButton({ summary, starting, onCancel }: { summary: SiteSummary; starting: boolean; onCancel: () => void }) {
  const allowed = canCancel(summary)
  const button = (
    <Button onClick={onCancel} disabled={starting || !allowed}>
      <X size={14} /> {summary.state.cancelling ? 'Cancelling…' : 'Cancel deploy'}
    </Button>
  )
  return allowed ? button : <Tooltip content={cancelBlockedReason(summary)}>{button}</Tooltip>
}

function DeployButton({ summary, pcDrift, starting, actions }: Omit<DetailHeaderProps, 'rollbackTo'>) {
  if (summary.state.pending) {
    return (
      <Button variant="primary" onClick={actions.approve} disabled={starting}>
        <Check size={14} /> Approve {shortSha(summary.state.pending)}
      </Button>
    )
  }
  return (
    <div className="flex items-center">
      <Button variant="primary" className="rounded-r-none" onClick={actions.deploy} disabled={starting}>
        {starting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} {deployLabel(summary, pcDrift)}
      </Button>
      <Dropdown
        align="right"
        trigger={
          <Button variant="primary" className="rounded-l-none border-l border-l-white/20 px-2" aria-label="More deploy options" disabled={starting}>
            <ChevronDown size={14} />
          </Button>
        }
        items={[{ id: 'now', label: 'Deploy without preview', icon: <Play size={13} /> }]}
        onSelect={() => actions.deployNow()}
      />
    </div>
  )
}

export function DetailHeader({ summary, pcDrift, starting, rollbackTo, actions }: DetailHeaderProps) {
  const { config, state } = summary
  const menu = [
    ...(config.sourceMode === 'auto' ? [{ id: 'key', label: 'Deploy key', icon: <KeyRound size={13} /> }] : []),
    { id: 'remove', label: 'Remove site', icon: <Trash2 size={13} />, danger: true }
  ]
  return (
    <header className="flex flex-wrap items-center gap-2.5">
      <Button size="icon" variant="ghost" aria-label="Back to sites" onClick={actions.back}><ArrowLeft size={16} /></Button>
      <button type="button" onClick={actions.back} className="text-[13px] text-nd-text-muted hover:text-nd-text-primary">Deploy</button>
      <span className="text-nd-text-muted">/</span>
      <h1 className="truncate text-lg font-semibold tracking-tight text-nd-text-primary">{config.name}</h1>
      <SiteStatusBadge summary={summary} pcDrift={pcDrift} />
      <BehindChip summary={summary} pcDrift={pcDrift} />
      <div className="flex-1" />
      {rollbackTo && (
        <Tooltip content={`Roll back to ${shortSha(rollbackTo.commit)}`}>
          <Button onClick={() => actions.rollback(rollbackTo)} disabled={state.busy || starting}><RotateCcw size={14} /> Rollback</Button>
        </Tooltip>
      )}
      {state.busy ? <CancelButton summary={summary} starting={starting} onCancel={actions.cancel} /> : <DeployButton summary={summary} pcDrift={pcDrift} starting={starting} actions={actions} />}
      <Dropdown
        align="right"
        trigger={<Button size="icon" variant="ghost" aria-label="More site actions"><MoreHorizontal size={16} /></Button>}
        items={menu}
        onSelect={(id) => (id === 'key' ? actions.keySetup() : actions.remove())}
      />
    </header>
  )
}
