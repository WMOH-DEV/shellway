import { useState } from 'react'
import { cn } from '@/utils/cn'
import type { DeployOptions, RemoteDrift, SiteConfig, SiteSummary } from '@/types/deploy'
import { rollbackTarget } from '@/utils/deploy/siteDetail'
import { DetailHeader, type DetailActions } from './detail/DetailHeader'
import { SummaryStrip } from './detail/SummaryStrip'
import { DeploymentsPane, SiteRunModals, useSiteRuns } from './detail/useSiteRuns'
import { EnvEditor } from './EnvEditor'
import { PipelineEditor } from './PipelineEditor'
import { ServerCheck } from './ServerCheck'
import { SiteForm } from './SiteForm'
import { deployApi } from './useDeploySites'
import { useServerCheck } from './useServerCheck'

export type DetailTab = 'history' | 'pipeline' | 'env' | 'check' | 'settings'

const TABS: { id: DetailTab; label: string }[] = [
  { id: 'history', label: 'History' },
  { id: 'pipeline', label: 'Pipeline' },
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
  onDeployNow: (options?: DeployOptions) => void
  onCancel: () => void
  onSaved: (site: SiteConfig) => void
  onPipelineSaved: () => void
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

export function SiteDetail({ connectionId, summary, pcDrift, user, starting, initialTab = 'history', onBack, onKeySetup, onDeploy, onDeployNow, onCancel, onSaved, onPipelineSaved, onRemoved }: SiteDetailProps) {
  const { config, state } = summary
  const [tab, setTab] = useState<DetailTab>(initialTab)
  const serverCheck = useServerCheck(connectionId, config)
  const runs = useSiteRuns(connectionId, config, () => setTab('history'), onRemoved)

  const pipelineSaved = () => {
    onPipelineSaved()
    void serverCheck.run()
  }

  const actions: DetailActions = {
    back: onBack,
    deploy: runs.followNewest(onDeploy),
    deployNow: runs.followNewest(() => onDeployNow()),
    cancel: onCancel,
    rollback: runs.askRollback,
    keySetup: onKeySetup,
    remove: () => runs.askRemove(true)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-nd-bg-primary">
      <div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col gap-4 px-7 pb-5 pt-5">
        <DetailHeader connectionId={connectionId} summary={summary} pcDrift={pcDrift} starting={starting} rollbackTo={rollbackTarget(summary)} actions={actions} />
        <SummaryStrip summary={summary} pcDrift={pcDrift} user={user} />
        <TabBar tab={tab} onChange={setTab} flagged={serverCheck.hasProblem ? 'check' : null} />
        <div className="min-h-0 flex-1">
          {tab === 'history' && <DeploymentsPane connectionId={connectionId} summary={summary} runs={runs} starting={starting} onDeployNow={onDeployNow} />}
          {tab === 'pipeline' && (
            <PipelineEditor connectionId={connectionId} summary={summary} onSaved={pipelineSaved} onOpenServerCheck={() => setTab('check')} />
          )}
          {tab === 'env' && (
            <EnvEditor connectionId={connectionId} site={config.name} canApply={Boolean(state.current) && !state.busy} onApply={() => void runs.runAndSelect(deployApi().apply(connectionId, config.name), 'Could not apply the change')} />
          )}
          {tab === 'check' && <ServerCheck site={config} check={serverCheck} />}
          {tab === 'settings' && (
            <div className="h-full overflow-y-auto">
              <SiteForm connectionId={connectionId} initial={config} existingNames={[]} onSaved={(site) => onSaved(site)} onCancel={() => setTab('history')} />
            </div>
          )}
        </div>
      </div>

      <SiteRunModals config={config} runs={runs} />
    </div>
  )
}
