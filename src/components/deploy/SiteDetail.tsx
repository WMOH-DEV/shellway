import { useState } from 'react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Splitter } from '@/components/ui/Splitter'
import { toast } from '@/components/ui/Toast'
import type { DeployRecord, DeployResult, RemoteDrift, SiteConfig, SiteSummary } from '@/types/deploy'
import { shortSha } from '@/utils/deploy/siteStatus'
import { canRetry, recordTitle, rollbackTarget } from '@/utils/deploy/siteDetail'
import { DetailHeader, type DetailActions } from './detail/DetailHeader'
import { HistoryList } from './detail/HistoryList'
import { RunPanel } from './detail/RunPanel'
import { SummaryStrip } from './detail/SummaryStrip'
import { EnvEditor } from './EnvEditor'
import { ServerCheck } from './ServerCheck'
import { SiteForm } from './SiteForm'
import { deployApi } from './useDeploySites'
import { useServerCheck } from './useServerCheck'

export type DetailTab = 'history' | 'env' | 'check' | 'settings'

const TABS: { id: DetailTab; label: string }[] = [
  { id: 'history', label: 'History' },
  { id: 'env', label: 'Env file' },
  { id: 'check', label: 'Server check' },
  { id: 'settings', label: 'Settings' }
]

interface SiteDetailProps {
  connectionId: string
  summary: SiteSummary
  pcDrift?: RemoteDrift
  user: string
  starting: boolean
  initialTab?: DetailTab
  onBack: () => void
  onKeySetup: () => void
  onDeploy: () => void
  onDeployNow: () => void
  onCancel: () => void
  onSaved: (site: SiteConfig) => void
  onRemoved: () => void
}

function TabBar({ tab, onChange, flagged }: { tab: DetailTab; onChange: (tab: DetailTab) => void; flagged: DetailTab | null }) {
  return (
    <div role="tablist" className="flex gap-5 border-b border-nd-border">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px border-b-2 px-0.5 py-2.5 text-[13px] transition-colors',
            tab === t.id ? 'border-nd-accent text-nd-text-primary' : 'border-transparent text-nd-text-muted hover:text-nd-text-secondary'
          )}
        >
          {t.label}
          {flagged === t.id && <span aria-label="has a problem" className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-nd-warning align-middle" />}
        </button>
      ))}
    </div>
  )
}

function rollbackBody(config: SiteConfig, record: DeployRecord): string {
  const target = `${shortSha(record.commit)} "${recordTitle(record)}"`
  return config.layout === 'releases'
    ? `The live site switches back to ${target} and the after-going-live commands run again.`
    : `The site folder is reset to ${target} and every command runs again.`
}

function ConfirmModal({ title, body, confirm, danger, onConfirm, onClose }: { title: string; body: string; confirm: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={title}>
      <p className="text-sm text-nd-text-secondary">{body}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirm}</Button>
      </div>
    </Modal>
  )
}

export function SiteDetail({ connectionId, summary, pcDrift, user, starting, initialTab = 'history', onBack, onKeySetup, onDeploy, onDeployNow, onCancel, onSaved, onRemoved }: SiteDetailProps) {
  const { config, state, history } = summary
  const [tab, setTab] = useState<DetailTab>(initialTab)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [rollbackTo, setRollbackTo] = useState<DeployRecord | null>(null)
  const selected = history.find((r) => r.id === selectedId) ?? history[0]
  const serverCheck = useServerCheck(connectionId, config)

  const runAndSelect = async (action: Promise<DeployResult<string>>, failure: string) => {
    const result = await action
    if (!result.success) {
      toast.error(failure, result.error)
      return
    }
    if (result.data) setSelectedId(result.data)
    setTab('history')
  }

  const followNewest = (start: () => void) => () => {
    setSelectedId(null)
    setTab('history')
    start()
  }

  const rollback = (record: DeployRecord) => {
    setRollbackTo(null)
    void runAndSelect(deployApi().rollback(connectionId, config.name, record.id), 'Rollback could not start')
  }

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

  const actions: DetailActions = {
    back: onBack,
    deploy: followNewest(onDeploy),
    deployNow: followNewest(onDeployNow),
    cancel: onCancel,
    rollback: setRollbackTo,
    keySetup: onKeySetup,
    remove: () => setConfirmRemove(true)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-nd-bg-primary">
      <div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col gap-4 px-7 pb-5 pt-5">
        <DetailHeader summary={summary} pcDrift={pcDrift} starting={starting} rollbackTo={rollbackTarget(summary)} actions={actions} />
        <SummaryStrip summary={summary} pcDrift={pcDrift} user={user} />
        <TabBar tab={tab} onChange={setTab} flagged={serverCheck.hasProblem ? 'check' : null} />
        <div className="min-h-0 flex-1">
          {tab === 'history' && (
            <Splitter
              defaultSplit={30}
              minSize={280}
              className="h-full rounded-[10px] border border-nd-border bg-nd-bg-secondary"
              left={<HistoryList summary={summary} selectedId={selected?.id} onSelect={setSelectedId} onRollback={setRollbackTo} />}
              right={selected
                ? <RunPanel connectionId={connectionId} summary={summary} record={selected} retry={{ allowed: canRetry(selected, summary), disabled: starting || state.busy, onRetry: actions.deployNow }} />
                : <div className="flex h-full items-center justify-center text-sm text-nd-text-muted">Deploy this site to see its first run here</div>}
            />
          )}
          {tab === 'env' && (
            <EnvEditor connectionId={connectionId} site={config.name} canApply={Boolean(state.current) && !state.busy} onApply={() => void runAndSelect(deployApi().apply(connectionId, config.name), 'Could not apply the change')} />
          )}
          {tab === 'check' && <ServerCheck site={config} check={serverCheck} />}
          {tab === 'settings' && (
            <div className="h-full overflow-y-auto">
              <SiteForm connectionId={connectionId} initial={config} existingNames={[]} onSaved={(site) => onSaved(site)} onCancel={() => setTab('history')} />
            </div>
          )}
        </div>
      </div>

      {rollbackTo && (
        <ConfirmModal
          title={`Roll back ${config.name}?`}
          body={rollbackBody(config, rollbackTo)}
          confirm="Roll back"
          onConfirm={() => rollback(rollbackTo)}
          onClose={() => setRollbackTo(null)}
        />
      )}
      {confirmRemove && (
        <ConfirmModal
          title={`Remove ${config.name}?`}
          body={`Shellway stops deploying this site and deletes its settings, history and deploy key from the server. The deployed code in ${config.path} is not touched.`}
          confirm="Remove"
          danger
          onConfirm={() => void remove()}
          onClose={() => setConfirmRemove(false)}
        />
      )}
    </div>
  )
}
