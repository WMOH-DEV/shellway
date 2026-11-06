import { useRef, useState, type ReactNode } from 'react'
import { toast } from '@/components/ui/Toast'
import { useSessionStore } from '@/stores/sessionStore'
import type { ConnectionStatus } from '@/types/session'
import type { DeployResult, SiteConfig } from '@/types/deploy'
import type { SiteFilter } from '@/utils/deploy/siteRow'
import { KeySetup } from './KeySetup'
import { SiteDetail } from './SiteDetail'
import { SiteForm } from './SiteForm'
import type { SiteActions } from './SiteRow'
import { SitesOverview } from './SitesOverview'
import { useAwaySummary } from './useAwaySummary'
import { deployApi, useDeploySites } from './useDeploySites'
import { useIsVisible } from './useIsVisible'

interface DeployViewProps {
  connectionId: string
  sessionId: string
  connectionStatus: ConnectionStatus
}

type Screen =
  | { kind: 'list' }
  | { kind: 'detail'; name: string }
  | { kind: 'form'; site: SiteConfig | null }
  | { kind: 'key'; site: SiteConfig }

function useStartingSites(): [ReadonlySet<string>, (name: string, task: () => Promise<void>) => Promise<void>] {
  const [starting, setStarting] = useState<ReadonlySet<string>>(new Set())
  const track = async (name: string, task: () => Promise<void>) => {
    setStarting((prev) => new Set(prev).add(name))
    try {
      await task()
    } finally {
      setStarting((prev) => {
        const next = new Set(prev)
        next.delete(name)
        return next
      })
    }
  }
  return [starting, track]
}

export function DeployView({ connectionId, sessionId, connectionStatus }: DeployViewProps) {
  const connected = connectionStatus === 'connected'
  const data = useDeploySites(connectionId, sessionId, connected)
  const { sites, pcDrift, refresh } = data
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })
  const [starting, track] = useStartingSites()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SiteFilter>('all')
  const rootRef = useRef<HTMLDivElement>(null)
  const visible = useIsVisible(rootRef)
  const away = useAwaySummary(sessionId, sites, visible && connected)
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId))
  const frame = (content: ReactNode) => <div ref={rootRef} className="h-full">{content}</div>

  const siteAction = (name: string, call: () => Promise<DeployResult<unknown>>, failure: string, onStarted: () => void) =>
    track(name, async () => {
      const result = await call()
      if (!result.success) {
        toast.error(failure, result.error)
        return
      }
      onStarted()
      await refresh()
    })

  const configOf = (name: string) => sites.find((s) => s.config.name === name)?.config

  const actions: SiteActions = {
    open: (name) => setScreen({ kind: 'detail', name }),
    deploy: (name) => void siteAction(name, () => deployApi().deploy(connectionId, name), `Could not deploy ${name}`, () => toast.info(`Deploying ${name}…`)),
    cancel: (name) => void siteAction(name, () => deployApi().cancel(connectionId, name), `Could not cancel ${name}`, () => toast.info(`Cancelling ${name}…`)),
    resume: (name) => void siteAction(
      name,
      () => deployApi().resume(connectionId, name),
      `Could not resume the auto check for ${name}`,
      () => toast.success(`Auto check resumed for ${name}`, 'It looks for new commits again within a minute')
    ),
    edit: (name) => {
      const site = configOf(name)
      if (site) setScreen({ kind: 'form', site })
    },
    keySetup: (name) => {
      const site = configOf(name)
      if (site) setScreen({ kind: 'key', site })
    }
  }

  const saved = (site: SiteConfig, isNew: boolean) => {
    toast.success(`${site.name} saved`)
    void refresh()
    setScreen(isNew && site.sourceMode === 'auto' ? { kind: 'key', site } : { kind: 'detail', name: site.name })
  }

  if (!connected) {
    return frame(<div className="flex h-full items-center justify-center text-sm text-nd-text-muted">Connect to this server to manage its deploys</div>)
  }

  const detailSite = screen.kind === 'detail' ? sites.find((s) => s.config.name === screen.name) : undefined

  if (screen.kind === 'form') {
    return frame(
      <SiteForm
        connectionId={connectionId}
        initial={screen.site}
        existingNames={sites.map((s) => s.config.name)}
        onSaved={saved}
        onCancel={() => setScreen(screen.site ? { kind: 'detail', name: screen.site.name } : { kind: 'list' })}
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
        connectionId={connectionId}
        summary={detailSite}
        pcDrift={pcDrift[name]}
        starting={starting.has(name)}
        onBack={() => setScreen({ kind: 'list' })}
        onEdit={() => actions.edit(name)}
        onKeySetup={() => actions.keySetup(name)}
        onDeploy={() => actions.deploy(name)}
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
      onAdd={() => setScreen({ kind: 'form', site: null })}
    />
  )
}
