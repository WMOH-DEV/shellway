import { useEffect, useState } from 'react'
import { RotateCw } from 'lucide-react'
import type { ProbeResult, ServerFacts } from '@/types/server/core'
import { Button } from '@/components/ui/Button'
import { Notice, PageHeader, ProbeState, SectionPage } from '@/components/server/kit'
import { useActionLauncher } from '@/components/server/action'
import { useServerFacts } from '@/components/server/useServerFacts'
import type { CleanupParams } from '@/utils/server/docker/actions/cleanup'
import { DOCKER_PROBE, dockerDiskUsage, factData } from '@/utils/server/docker/probes'
import { siteRoute } from '@/utils/server/docker/runForm'
import { formatSize } from '@/utils/server/docker/size'
import type { ContainerStats, DockerContainer, DockerImage, DockerList, DockerNetwork, DockerState, DockerVolume } from '@/utils/server/docker/types'
import type { ServerSectionContext } from '../types'
import { CleanupModal } from './CleanupModal'
import { LogsPanel } from './LogsPanel'
import { ImagesTab, NetworksTab, VolumesTab } from './ResourceTabs'
import { RunImagePanel, type RunRequest } from './RunImagePanel'
import { StacksTab } from './StacksTab'
import { useLinkedSites } from './useLinkedSites'
import { useWithOsFamily } from '../../useWithOsFamily'

const PROBE_IDS = Object.values(DOCKER_PROBE)

type DockerTab = 'stacks' | 'images' | 'volumes' | 'networks'

const TABS: { value: DockerTab; label: string }[] = [
  { value: 'stacks', label: 'Stacks & containers' },
  { value: 'images', label: 'Images' },
  { value: 'volumes', label: 'Volumes' },
  { value: 'networks', label: 'Networks' }
]

type Panel = { kind: 'run' } | { kind: 'logs'; container: string } | null

function reclaimable(facts: ServerFacts): number {
  const usage = dockerDiskUsage(facts)
  return (usage.images?.reclaimable ?? 0) + (usage.containers?.reclaimable ?? 0) + (usage.buildCache?.reclaimable ?? 0)
}

function subtitle(state: DockerState | null, facts: ServerFacts): string {
  if (!state?.installed) return 'Containers, images and compose stacks'
  const imagesSize = dockerDiskUsage(facts).images?.size
  return [
    state.serverVersion ?? state.clientVersion ? `Docker ${state.serverVersion ?? state.clientVersion}` : 'Docker',
    state.composeVersion ? `Compose v${state.composeVersion}` : 'no Compose plugin',
    imagesSize !== undefined ? `${formatSize(imagesSize)} of images` : null
  ].filter(Boolean).join(' · ')
}

function Tabs({ value, onChange }: { value: DockerTab; onChange(tab: DockerTab): void }) {
  return (
    <div role="tablist" aria-label="Docker" className="flex gap-6 border-b border-nd-border">
      {TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          onClick={() => onChange(tab.value)}
          className={tab.value === value ? 'whitespace-nowrap px-0.5 py-2.5 font-medium text-nd-text-primary shadow-[inset_0_-2px_0_rgb(var(--nd-accent))]' : 'whitespace-nowrap px-0.5 py-2.5 text-nd-text-muted hover:text-nd-text-primary'}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function UnavailableState({ state, onInstall, onServices }: { state: DockerState; onInstall(): void; onServices(): void }) {
  if (!state.installed) {
    return (
      <Notice tone="info" title="Docker is not installed" action={<Button variant="primary" onClick={onInstall}>Install Docker</Button>}>
        Installs Docker Engine and the Compose plugin from Docker's official repository.
      </Notice>
    )
  }
  if (state.access === 'none') {
    return (
      <Notice tone="warning" title="Shellway cannot use Docker with this user">
        The user is not in the docker group and sudo asks for a password. Add the user to the group (<span className="font-mono">sudo usermod -aG docker $USER</span>), then reconnect.
      </Notice>
    )
  }
  return (
    <Notice tone="error" title="The Docker service is not running" action={<Button onClick={onServices}>Open Services</Button>}>
      Start the docker service to see containers and images.
    </Notice>
  )
}

export function DockerSection({ ctx }: { ctx: ServerSectionContext }) {
  const { facts, loading, refresh } = useServerFacts(ctx, PROBE_IDS)
  const launcher = useActionLauncher(ctx)
  const withOsFamily = useWithOsFamily(ctx.sessionId)
  const [tab, setTab] = useState<DockerTab>('stacks')
  const [panel, setPanel] = useState<Panel>(null)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const routeContainer = ctx.route.params?.container

  useEffect(() => {
    if (routeContainer) setPanel({ kind: 'logs', container: routeContainer })
  }, [routeContainer])

  const launch = (type: string, params: unknown, after?: () => void) =>
    launcher.launch({ type, params, onFinished: (run) => { void refresh(); if (run.status === 'done') after?.() } })

  const runImage = ({ params, form }: RunRequest) => {
    setPanel(null)
    launch('docker.run', params, form.onDomain ? () => ctx.navigate(siteRoute(form, params)) : undefined)
  }

  const reviewCleanup = (params: CleanupParams) => {
    setCleanupOpen(false)
    launch('docker.cleanup', params)
  }

  const state = facts[DOCKER_PROBE.state] as ProbeResult<DockerState> | undefined
  const dockerState = factData<DockerState>(facts, DOCKER_PROBE.state)
  const ready = Boolean(dockerState?.installed && dockerState.access !== 'none' && dockerState.serverVersion)
  const containers = factData<DockerList<DockerContainer>>(facts, DOCKER_PROBE.containers)
  const sites = useLinkedSites(ctx.connectionId, ctx.sessionId, ctx.active && ready)
  const free = reclaimable(facts)

  const actions = (
    <>
      <Button variant="ghost" size="icon" aria-label="Refresh" disabled={loading} onClick={() => void refresh()}><RotateCw size={15} /></Button>
      {ready && <Button onClick={() => setCleanupOpen(true)}>Clean up unused{free > 0 ? ` · ${formatSize(free)}` : ''}</Button>}
      {ready && <Button variant="primary" onClick={() => setPanel({ kind: 'run' })}>Run an image</Button>}
    </>
  )

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <SectionPage>
          <PageHeader title="Docker" subtitle={subtitle(dockerState, facts)} actions={actions} />
          <ProbeState result={state} label="Docker">
            {(data: DockerState) => ready ? (
              <>
                <Tabs value={tab} onChange={setTab} />
                {tab === 'stacks' && (
                  <StacksTab
                    containers={containers?.items ?? []}
                    truncated={containers?.truncated ?? false}
                    stats={factData<ContainerStats[]>(facts, DOCKER_PROBE.stats) ?? []}
                    sites={sites}
                    onContainer={(op, name) => launch('docker.container', { op, name })}
                    onCompose={(op, project) => launch('docker.compose', { op, project })}
                    onLogs={(container) => setPanel({ kind: 'logs', container })}
                    onSite={(name) => ctx.navigate({ section: 'sites', sub: 'site', params: { name } })}
                  />
                )}
                {tab === 'images' && <ImagesTab images={factData<DockerImage[]>(facts, DOCKER_PROBE.images) ?? []} onPull={(image) => launch('docker.image-pull', { image })} onRemove={(image) => launch('docker.image-remove', { image })} />}
                {tab === 'volumes' && <VolumesTab volumes={factData<DockerVolume[]>(facts, DOCKER_PROBE.volumes) ?? []} containers={containers?.items ?? []} />}
                {tab === 'networks' && <NetworksTab networks={factData<DockerNetwork[]>(facts, DOCKER_PROBE.networks) ?? []} containers={containers?.items ?? []} />}
              </>
            ) : (
              <UnavailableState state={data} onInstall={() => launcher.launch({ type: 'software.install', params: withOsFamily({ component: 'docker' }), onFinished: () => void refresh() })} onServices={() => ctx.navigate({ section: 'services' })} />
            )}
          </ProbeState>
        </SectionPage>
      </div>
      {panel?.kind === 'run' && <RunImagePanel connectionId={ctx.connectionId} onClose={() => setPanel(null)} onRun={runImage} />}
      {panel?.kind === 'logs' && <LogsPanel connectionId={ctx.connectionId} tabId={ctx.tabId} container={panel.container} onClose={() => setPanel(null)} />}
      <CleanupModal open={cleanupOpen} facts={facts} onClose={() => setCleanupOpen(false)} onReview={reviewCleanup} />
    </div>
  )
}
