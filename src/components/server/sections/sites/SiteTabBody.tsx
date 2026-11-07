import type { ReactNode } from 'react'
import { EnvEditor } from '@/components/deploy/EnvEditor'
import { PipelineEditor } from '@/components/deploy/PipelineEditor'
import { SummaryStrip } from '@/components/deploy/detail/SummaryStrip'
import { DeploymentsPane } from '@/components/deploy/detail/useSiteRuns'
import { deployApi } from '@/components/deploy/useDeploySites'
import type { SiteTab } from './routes'
import type { SitePageProps } from './SiteDetailPage'
import { CommandsTab } from './tabs/CommandsTab'
import { DomainsTab } from './tabs/DomainsTab'
import { LogsTab } from './tabs/LogsTab'
import { OverviewTab } from './tabs/OverviewTab'
import { SettingsTab } from './tabs/SettingsTab'
import { WorkersTab } from './tabs/WorkersTab'

const Scroll = ({ children }: { children: ReactNode }) => <div className="h-full overflow-y-auto pb-2">{children}</div>

function DeploymentsTab({ page }: { page: SitePageProps }) {
  const { data, entry, runs } = page
  const { summary } = entry
  const name = summary.config.name
  return (
    <div className="flex h-full flex-col gap-4">
      <SummaryStrip summary={summary} pcDrift={data.deploy.pcDrift[name]} user={data.user} />
      <div className="min-h-0 flex-1">
        <DeploymentsPane connectionId={data.connectionId} summary={summary} runs={runs} starting={data.actions.starting.has(name)} onDeployNow={(options) => data.actions.deployNow(name, options)} />
      </div>
    </div>
  )
}

export function SiteTabBody({ tab, page }: { tab: SiteTab; page: SitePageProps }) {
  const { data, entry, runs, check } = page
  const { config, state } = entry.summary
  switch (tab) {
    case 'deployments':
      return <DeploymentsTab page={page} />
    case 'pipeline':
      return (
        <PipelineEditor
          connectionId={data.connectionId}
          summary={entry.summary}
          onSaved={() => { void data.deploy.refresh(); void check.run() }}
          onOpenServerCheck={() => page.openTab('settings')}
        />
      )
    case 'env':
      return (
        <EnvEditor
          connectionId={data.connectionId}
          site={config.name}
          canApply={Boolean(state.current) && !state.busy}
          onApply={() => void runs.runAndSelect(deployApi().apply(data.connectionId, config.name), 'Could not apply the change')}
        />
      )
    case 'domains':
      return <Scroll><DomainsTab page={page} /></Scroll>
    case 'workers':
      return <Scroll><WorkersTab page={page} /></Scroll>
    case 'logs':
      return <LogsTab page={page} />
    case 'commands':
      return <Scroll><CommandsTab page={page} /></Scroll>
    case 'settings':
      return <Scroll><SettingsTab page={page} /></Scroll>
    default:
      return <Scroll><OverviewTab page={page} /></Scroll>
  }
}
