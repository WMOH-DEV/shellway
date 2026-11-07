import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Splitter } from '@/components/ui/Splitter'
import { toast } from '@/components/ui/Toast'
import type { DeployOptions, DeployRecord, DeployResult, SiteConfig, SiteSummary } from '@/types/deploy'
import { shortSha } from '@/utils/deploy/siteStatus'
import { canRetry, recordTitle } from '@/utils/deploy/siteDetail'
import { deployApi } from '../useDeploySites'
import { HistoryList } from './HistoryList'
import { RunPanel } from './RunPanel'

export interface SiteRuns {
  selectedId: string | null
  select: (id: string | null) => void
  rollbackTo: DeployRecord | null
  askRollback: (record: DeployRecord | null) => void
  confirmRemove: boolean
  askRemove: (open: boolean) => void
  runAndSelect: (action: Promise<DeployResult<string>>, failure: string) => Promise<void>
  followNewest: (start: () => void) => () => void
  rollback: (record: DeployRecord) => void
  remove: () => Promise<void>
}

export function useSiteRuns(connectionId: string, config: SiteConfig, showHistory: () => void, onRemoved: () => void): SiteRuns {
  const [selectedId, select] = useState<string | null>(null)
  const [confirmRemove, askRemove] = useState(false)
  const [rollbackTo, askRollback] = useState<DeployRecord | null>(null)

  const runAndSelect = async (action: Promise<DeployResult<string>>, failure: string) => {
    const result = await action
    if (!result.success) {
      toast.error(failure, result.error)
      return
    }
    if (result.data) select(result.data)
    showHistory()
  }

  const followNewest = (start: () => void) => () => {
    select(null)
    showHistory()
    start()
  }

  const rollback = (record: DeployRecord) => {
    askRollback(null)
    void runAndSelect(deployApi().rollback(connectionId, config.name, record.id), 'Rollback could not start')
  }

  const remove = async () => {
    askRemove(false)
    const result = await deployApi().remove(connectionId, config.name)
    if (!result.success) {
      toast.error('Could not remove the site', result.error)
      return
    }
    toast.success(`${config.name} removed`, 'Deployed files on the server were left in place')
    onRemoved()
  }

  return { selectedId, select, rollbackTo, askRollback, confirmRemove, askRemove, runAndSelect, followNewest, rollback, remove }
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

export function SiteRunModals({ config, runs }: { config: SiteConfig; runs: SiteRuns }) {
  return (
    <>
      {runs.rollbackTo && (
        <ConfirmModal
          title={`Roll back ${config.name}?`}
          body={rollbackBody(config, runs.rollbackTo)}
          confirm="Roll back"
          onConfirm={() => runs.rollbackTo && runs.rollback(runs.rollbackTo)}
          onClose={() => runs.askRollback(null)}
        />
      )}
      {runs.confirmRemove && (
        <ConfirmModal
          title={`Remove ${config.name}?`}
          body={`Shellway stops deploying this site and deletes its settings, history and deploy key from the server. The deployed code in ${config.path} is not touched.`}
          confirm="Remove"
          danger
          onConfirm={() => void runs.remove()}
          onClose={() => runs.askRemove(false)}
        />
      )}
    </>
  )
}

interface DeploymentsPaneProps {
  connectionId: string
  summary: SiteSummary
  runs: SiteRuns
  starting: boolean
  onDeployNow: (options?: DeployOptions) => void
}

export function DeploymentsPane({ connectionId, summary, runs, starting, onDeployNow }: DeploymentsPaneProps) {
  const selected = summary.history.find((r) => r.id === runs.selectedId) ?? summary.history[0]
  const retry = (record: DeployRecord) => runs.followNewest(() => onDeployNow(record.commit ? { commit: record.commit } : undefined))
  return (
    <Splitter
      defaultSplit={30}
      minSize={280}
      className="h-full rounded-[10px] border border-nd-border bg-nd-bg-secondary"
      left={<HistoryList summary={summary} selectedId={selected?.id} onSelect={runs.select} onRollback={runs.askRollback} />}
      right={selected
        ? <RunPanel key={selected.id} connectionId={connectionId} summary={summary} record={selected} retry={{ allowed: canRetry(selected, summary), disabled: starting || summary.state.busy, onRetry: retry(selected) }} />
        : <div className="flex h-full items-center justify-center text-sm text-nd-text-muted">Deploy this site to see its first run here</div>}
    />
  )
}
