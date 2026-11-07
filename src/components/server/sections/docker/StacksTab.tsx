import { Play, RotateCw, ScrollText, Square, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Chip, Notice, StatusDot, type KitTone } from '@/components/server/kit'
import type { ComposeOp } from '@/utils/server/docker/actions/compose'
import type { ContainerOp } from '@/utils/server/docker/actions/container'
import { isCrashed, publicBindings } from '@/utils/server/docker/exposure'
import { groupStacks, linkedSite, portViews, type SiteRef, type Stack } from '@/utils/server/docker/stacks'
import type { ContainerStats, DockerContainer } from '@/utils/server/docker/types'

export interface StacksTabProps {
  containers: DockerContainer[]
  truncated: boolean
  stats: ContainerStats[]
  sites: SiteRef[]
  onContainer(op: ContainerOp, name: string): void
  onCompose(op: ComposeOp, project: string): void
  onLogs(name: string): void
  onSite(name: string): void
}

function statusTone(container: DockerContainer): KitTone {
  if (isCrashed(container) || container.health === 'unhealthy') return 'error'
  if (container.status === 'running') return container.health === 'starting' ? 'warning' : 'success'
  if (container.status === 'restarting') return 'warning'
  if (container.status === 'paused') return 'info'
  return 'neutral'
}

function IconAction({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="rounded-md p-1.5 text-nd-text-muted hover:bg-nd-surface-hover hover:text-nd-text-primary">
      {children}
    </button>
  )
}

function Ports({ container }: { container: DockerContainer }) {
  const views = portViews(container)
  if (views.length === 0) return <span className="text-nd-text-muted">internal</span>
  return (
    <span className="flex flex-wrap gap-1">
      {views.map((view) => (view.isPublic ? <Chip key={view.text} tone="warning" dense mono>{view.text}</Chip> : <span key={view.text}>{view.text}</span>))}
    </span>
  )
}

function ContainerRow({ container, stats, props }: { container: DockerContainer; stats: ContainerStats | undefined; props: StacksTabProps }) {
  const running = container.status === 'running' || container.status === 'restarting'
  const tone = statusTone(container)
  return (
    <div className="grid grid-cols-[14px_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)_56px_72px_auto] items-center gap-3 border-t border-nd-border px-4 py-2.5 text-[13px] hover:bg-nd-surface-hover">
      <StatusDot tone={tone} label={container.status} />
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-mono text-nd-text-primary">{container.name}</span>
        {tone === 'error' && <span className="truncate text-xs text-nd-error-fg">Exited with code {container.exitCode}</span>}
        {container.status !== 'running' && tone !== 'error' && <span className="text-xs text-nd-text-muted">{container.status}</span>}
      </div>
      <span className="truncate font-mono text-xs text-nd-text-secondary">{container.image}</span>
      <span className="min-w-0 font-mono text-xs text-nd-text-secondary"><Ports container={container} /></span>
      <span className="text-xs text-nd-text-muted">{stats?.cpu ?? ''}</span>
      <span className="text-xs text-nd-text-muted">{stats?.memory ?? ''}</span>
      <span className="flex items-center gap-0.5">
        <IconAction label={`Logs for ${container.name}`} onClick={() => props.onLogs(container.name)}><ScrollText size={15} /></IconAction>
        {running ? (
          <IconAction label={`Stop ${container.name}`} onClick={() => props.onContainer('stop', container.name)}><Square size={14} /></IconAction>
        ) : (
          <IconAction label={`Start ${container.name}`} onClick={() => props.onContainer('start', container.name)}><Play size={15} /></IconAction>
        )}
        <IconAction label={`Restart ${container.name}`} onClick={() => props.onContainer('restart', container.name)}><RotateCw size={14} /></IconAction>
        <IconAction label={`Remove ${container.name}`} onClick={() => props.onContainer('remove', container.name)}><Trash2 size={14} /></IconAction>
      </span>
    </div>
  )
}

function StackHeader({ stack, props }: { stack: Stack; props: StacksTabProps }) {
  if (stack.project === null) return <h2 className="text-[15px] font-semibold text-nd-text-primary">Other containers</h2>
  const project = stack.project
  const site = linkedSite(stack, props.sites)
  return (
    <>
      <h2 className="font-mono text-[15px] font-semibold text-nd-text-primary">{project}</h2>
      <span className="min-w-0 truncate font-mono text-xs text-nd-text-muted">{stack.configFile || stack.workingDir}</span>
      {site && (
        <button type="button" onClick={() => props.onSite(site.name)} className="text-xs text-nd-accent hover:underline">
          {site.name}
        </button>
      )}
      <div className="flex-1" />
      <Button size="sm" variant="ghost" onClick={() => props.onCompose('restart', project)}>Restart</Button>
      {stack.containers.some((container) => container.status === 'running') ? (
        <Button size="sm" variant="ghost" onClick={() => props.onCompose('down', project)}>Stop stack</Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => props.onCompose('up', project)}>Start stack</Button>
      )}
      <Button size="sm" onClick={() => props.onCompose('pull', project)}>Pull &amp; recreate</Button>
    </>
  )
}

function StackCard({ stack, statsByName, props }: { stack: Stack; statsByName: Map<string, ContainerStats>; props: StacksTabProps }) {
  return (
    <section aria-label={stack.project ?? 'Other containers'} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-nd-border bg-nd-surface">
      <div className="flex flex-wrap items-center gap-2.5 px-4 py-3">
        <StackHeader stack={stack} props={props} />
      </div>
      {stack.containers.map((container) => (
        <ContainerRow key={container.id} container={container} stats={statsByName.get(container.name)} props={props} />
      ))}
    </section>
  )
}

function ExposureNotice({ containers }: { containers: DockerContainer[] }) {
  const exposed = containers.filter((container) => container.status === 'running' && publicBindings(container).length > 0)
  if (exposed.length === 0) return null
  return (
    <Notice tone="warning" title={`${exposed.length === 1 ? 'A container is' : `${exposed.length} containers are`} open to the internet`}>
      Docker skips the ufw firewall for published ports: <span className="font-mono">{exposed.map((container) => container.name).join(', ')}</span>. Bind them to 127.0.0.1 unless they must be public.
    </Notice>
  )
}

export function StacksTab(props: StacksTabProps) {
  const stacks = groupStacks(props.containers)
  const statsByName = new Map(props.stats.map((entry) => [entry.name, entry]))
  if (stacks.length === 0) return <p className="py-6 text-[13px] text-nd-text-muted">No containers yet. Use Run an image to start one.</p>
  return (
    <div className="flex flex-col gap-4">
      <ExposureNotice containers={props.containers} />
      {stacks.map((stack) => (
        <StackCard key={stack.project ?? '-'} stack={stack} statsByName={statsByName} props={props} />
      ))}
      {props.truncated && <p className="text-xs text-nd-text-muted">Showing the first {props.containers.length} containers.</p>}
    </div>
  )
}
