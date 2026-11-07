import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import type { ServerSection } from '@/types/server/core'
import { removableComponent } from '@/utils/server/software/actions/packages'
import { catalogRow, type CatalogRow } from '@/utils/server/software/catalogView'
import { bindingsFor, isPublicBinding } from '@/utils/server/software/packages'
import type { CatalogEntry, PackagesFacts } from '@/utils/server/software/types'
import { Chip, Label, Notice, SectionCard } from '../../kit'
import type { ServerSectionContext } from '../types'
import type { SoftwareState } from './useSoftware'

interface PanelProps {
  entry: CatalogEntry
  packages: PackagesFacts
  ctx: ServerSectionContext
  state: SoftwareState
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label>{label}</Label>
      <span className="truncate text-[13px] text-nd-text-primary">{children}</span>
    </div>
  )
}

export const rowFor = (entry: CatalogEntry, packages: PackagesFacts, state: SoftwareState): CatalogRow => catalogRow(entry, { packages, php: state.phpData, usage: state.usageData })

export function InstallCard({ entry, run, extra }: { entry: CatalogEntry; run: SoftwareState['run']; extra?: Record<string, string> }) {
  const install = entry.component ? <Button size="sm" variant="primary" onClick={() => run('software.install', { component: entry.component, ...extra })}>Install</Button> : null
  return (
    <SectionCard title={entry.name} aside={install}>
      <p className="text-[13px] text-nd-text-muted">Not installed. Install shows every command before it runs.</p>
    </SectionCard>
  )
}

export function Actions({ row, run }: { row: CatalogRow; run: SoftwareState['run'] }) {
  const canRemove = row.entry.component && removableComponent(row.entry.id)
  return (
    <div className="flex items-center gap-2">
      {row.updatePackages.length > 0 && <Button size="sm" variant="primary" onClick={() => run('software.upgrade', { mode: 'selected', packages: row.updatePackages })}>Update</Button>}
      {canRemove && <Button size="sm" variant="ghost" onClick={() => run('software.remove', { component: row.entry.component })}>Remove</Button>}
    </div>
  )
}

export function ComponentFacts({ row }: { row: CatalogRow }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <Fact label="Version"><span className="font-mono">{row.version ?? 'unknown'}</span></Fact>
      <Fact label="Status">{row.detail}</Fact>
      <Fact label="Update">{row.update ?? 'up to date'}</Fact>
    </div>
  )
}

interface ManagedIn {
  section: ServerSection
  title: string
  button: string
}

const MANAGED_IN: Record<string, ManagedIn> = {
  docker: { section: 'docker', title: 'Containers live in the Docker section', button: 'Open Docker' },
  certbot: { section: 'sites', title: 'Certificates and renewals live in Sites', button: 'Open Sites' },
  ufw: { section: 'security', title: 'Firewall rules live in Security', button: 'Open Security' },
  fail2ban: { section: 'security', title: 'Jails and bans live in Security', button: 'Open Security' },
  'unattended-upgrades': { section: 'security', title: 'Automatic updates are set in Security', button: 'Open Security' },
  supervisor: { section: 'jobs', title: 'Programs live in Cron & workers', button: 'Open Cron & workers' }
}

function ManagedNotice({ id, ctx }: { id: string; ctx: ServerSectionContext }) {
  const target = MANAGED_IN[id]
  if (!target) return null
  return <Notice tone="info" title={target.title} action={<Button size="sm" onClick={() => ctx.navigate({ section: target.section })}>{target.button}</Button>} />
}

export function ServicesLink({ service, ctx }: { service: string | undefined; ctx: ServerSectionContext }) {
  if (!service) return null
  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 text-xs text-nd-text-muted">Start, stop and logs for <span className="font-mono">{service}</span> are in Services.</span>
      <Button size="sm" onClick={() => ctx.navigate({ section: 'services' })}>Open Services</Button>
    </div>
  )
}

export function ComponentPanel({ entry, packages, ctx, state }: PanelProps) {
  const row = rowFor(entry, packages, state)
  if (!row.installed) return <InstallCard entry={entry} run={state.run} />
  return (
    <SectionCard title={entry.name} aside={<Actions row={row} run={state.run} />}>
      <ComponentFacts row={row} />
      <ManagedNotice id={entry.id} ctx={ctx} />
      <ServicesLink service={entry.service} ctx={ctx} />
    </SectionCard>
  )
}

const DATABASE_PORTS: Record<string, number> = { mysql: 3306, mariadb: 3306, postgresql: 5432 }

function Bindings({ addresses }: { addresses: string[] }) {
  if (addresses.length === 0) return <span className="text-nd-text-muted">not listening</span>
  return (
    <span className="flex flex-wrap gap-1.5">
      {addresses.map((address) => <Chip key={address} tone={isPublicBinding(address) ? 'warning' : 'neutral'} dense mono>{address}</Chip>)}
    </span>
  )
}

export function DatabasePanel({ entry, packages, ctx, state }: PanelProps) {
  const row = rowFor(entry, packages, state)
  if (!row.installed) return <InstallCard entry={entry} run={state.run} />
  const addresses = bindingsFor(packages, DATABASE_PORTS[entry.id])
  const exposed = addresses.some(isPublicBinding)
  return (
    <SectionCard title={entry.name} aside={<Actions row={row} run={state.run} />}>
      <div className="grid grid-cols-3 gap-4">
        <Fact label="Version"><span className="font-mono">{row.version}</span></Fact>
        <Fact label="Status">{row.detail}</Fact>
        <Fact label="Listens on"><Bindings addresses={addresses} /></Fact>
      </div>
      {exposed && <Notice tone="warning" title="Reachable from the internet">{entry.name} listens on every network interface. Bind it to 127.0.0.1 unless other servers must connect.</Notice>}
      <div className="flex items-center gap-3">
        <span className="flex-1 text-xs text-nd-text-muted">Create databases and users in the Databases section.</span>
        <Button size="sm" onClick={() => ctx.navigate({ section: 'databases' })}>Open Databases</Button>
      </div>
    </SectionCard>
  )
}

const NODE_SOURCE_TEXT: Record<string, string> = {
  nodesource: 'NodeSource apt repository',
  distro: 'OS packages',
  nvm: 'nvm (per user, managed outside Shellway)',
  other: 'installed manually'
}

export function NodePanel({ entry, packages, ctx, state }: PanelProps) {
  const node = packages.node
  const nodeRow = rowFor(entry, packages, state)
  const installPm2 = <Button size="sm" onClick={() => state.run('software.install', { component: 'pm2' })}>Install pm2</Button>
  return (
    <div className="flex flex-col gap-3">
      {node.source ? (
        <SectionCard title="Node.js" aside={<Actions row={nodeRow} run={state.run} />}>
          <div className="grid grid-cols-3 gap-4">
            <Fact label="Version"><span className="font-mono">{node.version ?? 'not in PATH'}</span></Fact>
            <Fact label="Source">{NODE_SOURCE_TEXT[node.source]}</Fact>
            <Fact label="Update">{nodeRow.update ?? 'up to date'}</Fact>
          </div>
          {node.nvmVersions.length > 0 && <p className="text-xs text-nd-text-muted">nvm versions: <span className="font-mono">{node.nvmVersions.join(', ')}</span></p>}
        </SectionCard>
      ) : (
        <InstallCard entry={entry} run={state.run} />
      )}
      <SectionCard title="pm2" aside={node.pm2Version ? <Button size="sm" onClick={() => ctx.navigate({ section: 'jobs' })}>Open workers</Button> : installPm2}>
        <p className="text-[13px] text-nd-text-muted">
          {node.pm2Version ? <>Version <span className="font-mono">{node.pm2Version}</span>. pm2 runs per user; its apps are listed in Cron &amp; workers.</> : 'pm2 keeps Node apps running and restarts them on boot.'}
        </p>
      </SectionCard>
    </div>
  )
}
