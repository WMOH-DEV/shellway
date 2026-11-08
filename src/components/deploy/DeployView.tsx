import { useRef, useState, type ReactNode } from 'react'
import { toast } from '@/components/ui/Toast'
import { useSessionStore } from '@/stores/sessionStore'
import type { RunRecord } from '@/types/createSite'
import type { ConnectionStatus } from '@/types/session'
import type { SiteConfig } from '@/types/deploy'
import type { SiteFilter } from '@/utils/deploy/siteRow'
import { CreateSiteWizard } from './createSite/CreateSiteWizard'
import { useUnfinishedRun } from './createSite/useUnfinishedRun'
import { KeySetup } from './KeySetup'
import { SiteDetail, type DetailTab } from './SiteDetail'
import { SetupWizard } from './setup/SetupWizard'
import { ShipPreview } from './ShipPreview'
import type { SiteActions } from './SiteRow'
import { SitesOverview } from './SitesOverview'
import { useAwaySummary } from './useAwaySummary'
import { useDeployActions } from './useDeployActions'
import { useDeploySites } from './useDeploySites'
import { useIsVisible } from './useIsVisible'

interface DeployViewProps {
  connectionId: string
  sessionId: string
  connectionStatus: ConnectionStatus
}

type Screen =
  | { kind: 'list' }
  | { kind: 'detail'; name: string; tab?: DetailTab }
  | { kind: 'setup' }
  | { kind: 'create'; run: RunRecord | null }
  | { kind: 'key'; site: SiteConfig }

export function DeployView({ connectionId, sessionId, connectionStatus }: DeployViewProps) {
  const connected = connectionStatus === 'connected'
  const data = useDeploySites(connectionId, sessionId, connected)
  const { sites, pcDrift, refresh } = data
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })
  const [shipping, setShipping] = useState<string | null>(null)
  const { starting, deployNow, approve, cancel, resume } = useDeployActions(connectionId, refresh)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SiteFilter>('all')
  const rootRef = useRef<HTMLDivElement>(null)
  const visible = useIsVisible(rootRef)
  const away = useAwaySummary(sessionId, sites, visible && connected)
  const unfinished = useUnfinishedRun(sessionId, connected)
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId))
  const shipSite = shipping ? sites.find((s) => s.config.name === shipping) : undefined
  const frame = (content: ReactNode) => (
    <div ref={rootRef} className="h-full">
      {content}
      {shipSite && (
        <ShipPreview
          connectionId={connectionId}
          summary={shipSite}
          open
          onClose={() => setShipping(null)}
          onDeploy={(options) => deployNow(shipSite.config.name, options)}
          onApprove={() => approve(shipSite.config.name)}
          onEditPipeline={() => {
            setShipping(null)
            setScreen({ kind: 'detail', name: shipSite.config.name, tab: 'pipeline' })
          }}
        />
      )}
    </div>
  )

  const configOf = (name: string) => sites.find((s) => s.config.name === name)?.config

  const actions: SiteActions = {
    open: (name) => setScreen({ kind: 'detail', name }),
    deploy: (name) => setShipping(name),
    cancel,
    resume,
    edit: (name) => setScreen({ kind: 'detail', name, tab: 'settings' }),
    keySetup: (name) => {
      const site = configOf(name)
      if (site) setScreen({ kind: 'key', site })
    }
  }

  const setupFinished = (site: SiteConfig) => {
    toast.info(`Deploying ${site.name}…`)
    void refresh()
    setScreen({ kind: 'detail', name: site.name })
  }

  if (!connected) {
    return frame(<div className="flex h-full items-center justify-center text-sm text-nd-text-muted">Connect to this server to manage its deploys</div>)
  }

  const detailSite = screen.kind === 'detail' ? sites.find((s) => s.config.name === screen.name) : undefined

  if (screen.kind === 'setup') {
    return frame(
      <SetupWizard
        connectionId={connectionId}
        existingNames={sites.map((s) => s.config.name)}
        onCancel={() => setScreen({ kind: 'list' })}
        onSiteSaved={() => void refresh()}
        onFinished={setupFinished}
      />
    )
  }

  if (screen.kind === 'create') {
    const closeCreate = () => {
      setScreen({ kind: 'list' })
      void refresh()
      void unfinished.refresh()
    }
    return frame(
      <CreateSiteWizard
        connectionId={connectionId}
        sessionId={sessionId}
        serverName={session?.name ?? 'this server'}
        initialRun={screen.run}
        onClose={closeCreate}
      />
    )
  }

  if (screen.kind === 'key') {
    return frame(<KeySetup connectionId={connectionId} site={screen.site} onDone={() => setScreen({ kind: 'detail', name: screen.site.name })} />)
  }

  if (detailSite) {
    const { name } = detailSite.config
    return frame(
      <SiteDetail
        key={`${name}:${screen.kind === 'detail' ? screen.tab ?? '' : ''}`}
        connectionId={connectionId}
        summary={detailSite}
        pcDrift={pcDrift[name]}
        user={session?.username ?? ''}
        starting={starting.has(name)}
        initialTab={screen.kind === 'detail' ? screen.tab : undefined}
        onBack={() => setScreen({ kind: 'list' })}
        onSaved={(site) => { toast.success(`${site.name} saved`); void refresh() }}
        onPipelineSaved={() => void refresh()}
        onKeySetup={() => actions.keySetup(name)}
        onDeploy={() => actions.deploy(name)}
        onDeployNow={(options) => deployNow(name, options)}
        onCancel={() => actions.cancel(name)}
        onRemoved={() => { setScreen({ kind: 'list' }); void refresh() }}
      />
    )
  }

  return frame(
    <SitesOverview
      data={data}
      filters={{ query, filter, setQuery, setFilter }}
      away={away}
      serverName={session?.name ?? 'this server'}
      user={session?.username ?? ''}
      starting={starting}
      actions={actions}
      createSite={{
        unfinished: unfinished.run,
        onCreate: () => setScreen({ kind: 'create', run: null }),
        onOpenRun: (run) => setScreen({ kind: 'create', run })
      }}
      onAdd={() => setScreen({ kind: 'setup' })}
    />
  )
}
