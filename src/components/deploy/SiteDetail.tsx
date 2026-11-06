import { useState } from 'react'
import { ArrowLeft, Check, KeyRound, Pencil, Play, RotateCcw, Trash2, X } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import type { DeployRecord, RemoteDrift, SiteSummary } from '@/types/deploy'
import { commitsBehind, duration, isInterrupted, knownRemoteHead, shortSha, timeAgo } from '@/utils/deploy/siteStatus'
import { canCancel, cancelBlockedReason } from '@/utils/deploy/siteRow'
import { Tooltip } from '@/components/ui/Tooltip'
import { DeployLog } from './DeployLog'
import { EnvEditor } from './EnvEditor'
import { ServerCheck } from './ServerCheck'
import { SiteStatusBadge } from './SiteStatusBadge'
import { deployApi } from './useDeploySites'

type Tab = 'history' | 'env' | 'check'

interface SiteDetailProps {
  connectionId: string
  summary: SiteSummary
  pcDrift?: RemoteDrift
  starting: boolean
  onBack: () => void
  onEdit: () => void
  onKeySetup: () => void
  onDeploy: () => void
  onCancel: () => void
  onRemoved: () => void
}

const STATUS_STYLE: Record<DeployRecord['status'], string> = {
  running: 'text-nd-accent',
  success: 'text-nd-success',
  warning: 'text-nd-warning',
  failed: 'text-nd-error',
  reverted: 'text-nd-error',
  waiting: 'text-nd-warning',
  cancelled: 'text-nd-text-muted'
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'history', label: 'History' },
  { id: 'env', label: 'Env file' },
  { id: 'check', label: 'Server check' }
]

function CancelButton({ summary, starting, onCancel }: { summary: SiteSummary; starting: boolean; onCancel: () => void }) {
  const allowed = canCancel(summary)
  const button = (
    <Button size="sm" onClick={onCancel} disabled={starting || !allowed}>
      <X size={12} /> {summary.state.cancelling ? 'Cancelling…' : 'Cancel'}
    </Button>
  )
  return allowed ? button : <Tooltip content={cancelBlockedReason(summary)}>{button}</Tooltip>
}

function canRollBackTo(summary: SiteSummary, record: DeployRecord): boolean {
  if (record.trigger === 'env' || (record.status !== 'success' && record.status !== 'warning')) return false
  if (summary.config.layout === 'releases') return record.id !== summary.state.currentRelease
  return record.commit !== summary.state.current
}

export function SiteDetail({ connectionId, summary, pcDrift, starting, onBack, onEdit, onKeySetup, onDeploy, onCancel, onRemoved }: SiteDetailProps) {
  const { config, state, history } = summary
  const [tab, setTab] = useState<Tab>('history')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const selected = history.find((r) => r.id === selectedId) ?? history[0]
  const busy = state.busy
  const head = knownRemoteHead(summary, pcDrift)
  const behind = commitsBehind(summary, pcDrift)

  const runAndSelect = async (action: Promise<{ success: boolean; data?: string; error?: string }>, failure: string) => {
    const result = await action
    if (!result.success) {
      toast.error(failure, result.error)
      return
    }
    if (result.data) setSelectedId(result.data)
    setTab('history')
  }

  const deployLatest = () => {
    setSelectedId(null)
    setTab('history')
    onDeploy()
  }

  const rollback = (record: DeployRecord) =>
    runAndSelect(deployApi().rollback(connectionId, config.name, record.id), 'Rollback could not start')
  const approve = () => runAndSelect(deployApi().approve(connectionId, config.name), 'Could not approve')
  const applyEnv = () => runAndSelect(deployApi().apply(connectionId, config.name), 'Could not apply the change')

  const remove = async () => {
    const result = await deployApi().remove(connectionId, config.name)
    setConfirmRemove(false)
    if (!result.success) {
      toast.error('Could not remove the site', result.error)
      return
    }
    toast.success(`${config.name} removed`, 'Deployed files on the server were left in place')
    onRemoved()
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-nd-border px-4 py-2.5">
        <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft size={13} /></Button>
        <h2 className="text-sm font-semibold text-nd-text-primary">{config.name}</h2>
        <SiteStatusBadge summary={summary} pcDrift={pcDrift} />
        <div className="ml-auto flex items-center gap-1.5">
          {state.pending && (
            <Button size="sm" variant="primary" onClick={() => void approve()} disabled={busy}>
              <Check size={12} /> Approve {shortSha(state.pending)}
            </Button>
          )}
          {busy ? <CancelButton summary={summary} starting={starting} onCancel={onCancel} /> : (
            <Button size="sm" variant="primary" onClick={deployLatest} disabled={starting}><Play size={12} /> Deploy</Button>
          )}
          {config.sourceMode === 'auto' && <Button size="sm" variant="ghost" onClick={onKeySetup}><KeyRound size={12} /> Deploy key</Button>}
          <Button size="sm" variant="ghost" onClick={onEdit}><Pencil size={12} /> Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}><Trash2 size={12} /></Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-nd-border px-4 py-2 text-2xs text-nd-text-secondary">
        <span className="font-mono">{config.path}</span>
        <span>{config.repoUrl} · {config.branch}</span>
        <span>live <span className="font-mono">{state.current ? shortSha(state.current) : 'nothing yet'}</span></span>
        {head && head !== state.current && (
          <span>
            newest <span className="font-mono">{shortSha(head)}</span>
            {behind ? ` · ${behind} commit${behind > 1 ? 's' : ''} behind` : ''}
          </span>
        )}
        {config.sourceMode === 'auto' && state.heartbeat !== null && <span>checked {timeAgo(state.heartbeat, state.now)}</span>}
      </div>

      <div className="flex gap-1 border-b border-nd-border px-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'border-b-2 px-3 py-2 text-xs transition-colors',
              tab === t.id ? 'border-nd-accent text-nd-text-primary' : 'border-transparent text-nd-text-muted hover:text-nd-text-secondary'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'history' && (
          <div className="flex h-full">
            <div className="w-[46%] min-w-[320px] overflow-y-auto border-r border-nd-border">
              {history.length === 0 && <div className="p-4 text-xs text-nd-text-muted">No deploys yet</div>}
              {history.map((record) => (
                <div
                  key={record.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(record.id)}
                  onKeyDown={(e) => e.key === 'Enter' && setSelectedId(record.id)}
                  className={cn(
                    'flex cursor-pointer flex-col gap-0.5 border-b border-nd-border px-4 py-2 transition-colors',
                    selected?.id === record.id ? 'bg-nd-surface' : 'hover:bg-nd-surface/60'
                  )}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className={cn('font-medium capitalize', STATUS_STYLE[isInterrupted(record, summary) ? 'failed' : record.status])}>
                      {isInterrupted(record, summary) ? 'interrupted' : record.status}
                    </span>
                    <span className="font-mono text-nd-text-secondary">{record.commit ? shortSha(record.commit) : '…'}</span>
                    <span className="text-2xs text-nd-text-muted">{record.trigger}</span>
                    {record.id === state.currentRelease && <span className="text-2xs text-nd-success">current</span>}
                    <span className="ml-auto text-2xs text-nd-text-muted">{timeAgo(record.started, state.now)} {duration(record)}</span>
                    {canRollBackTo(summary, record) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5"
                        title="Roll back to this deploy"
                        disabled={busy}
                        onClick={(e) => { e.stopPropagation(); void rollback(record) }}
                      >
                        <RotateCcw size={11} />
                      </Button>
                    )}
                  </div>
                  {record.note && <div className="text-2xs text-nd-text-muted">{record.note}</div>}
                  {record.warnings > 0 && <div className="text-2xs text-nd-warning">{record.warnings} optional command{record.warnings > 1 ? 's' : ''} failed</div>}
                </div>
              ))}
            </div>
            <div className="min-w-0 flex-1 p-3">
              {selected && <DeployLog connectionId={connectionId} site={config.name} record={selected} live={selected.status === 'running' && state.busy} />}
            </div>
          </div>
        )}
        {tab === 'env' && <EnvEditor connectionId={connectionId} site={config.name} canApply={Boolean(state.current) && !busy} onApply={() => void applyEnv()} />}
        {tab === 'check' && <ServerCheck connectionId={connectionId} site={config} />}
      </div>

      <Modal open={confirmRemove} onClose={() => setConfirmRemove(false)} title={`Remove ${config.name}?`}>
        <p className="text-sm text-nd-text-secondary">
          Shellway stops deploying this site and deletes its settings, history and deploy key from the server. The deployed code in {config.path} is not touched.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmRemove(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => void remove()}>Remove</Button>
        </div>
      </Modal>
    </div>
  )
}
