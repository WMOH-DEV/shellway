import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { CATALOG_GROUPS } from '@/utils/server/software/catalog'
import { catalogRows, type CatalogRow } from '@/utils/server/software/catalogView'
import type { PackagesFacts } from '@/utils/server/software/types'
import { Chip, Label, Notice, ProbeState, StatusDot } from '../../kit'
import type { ServerSectionContext } from '../types'
import type { SoftwareState } from './useSoftware'

const DATABASES = new Set(['mysql', 'mariadb', 'postgresql'])

export const panelOf = (row: CatalogRow): string => row.entry.panel ?? row.entry.id

interface RowAction {
  label: string
  primary?: boolean
  onClick?: () => void
}

function rowAction(row: CatalogRow, ctx: ServerSectionContext, state: SoftwareState): RowAction | null {
  const { entry } = row
  const open = () => ctx.navigate({ section: 'software', sub: panelOf(row) })
  if (entry.id === 'base') return row.tone === 'success' ? { label: 'OK' } : null
  if (!row.installed) {
    if (entry.id === 'php' || !entry.component) return { label: 'Install', onClick: open }
    return { label: 'Install', onClick: () => state.run('software.install', { component: entry.component }) }
  }
  if (row.updatePackages.length > 0) return { label: 'Update', primary: true, onClick: () => state.run('software.upgrade', { mode: 'selected', packages: row.updatePackages }) }
  if (entry.id === 'docker') return { label: 'Open', onClick: () => ctx.navigate({ section: 'docker' }) }
  if (DATABASES.has(entry.id)) return { label: 'Open', onClick: () => ctx.navigate({ section: 'databases' }) }
  return { label: entry.id === 'nginx' || entry.id === 'apache' ? 'Configure' : 'Manage', onClick: open }
}

function CatalogItem({ row, ctx, state, selected }: { row: CatalogRow; ctx: ServerSectionContext; state: SoftwareState; selected: boolean }) {
  const action = rowAction(row, ctx, state)
  const select = () => ctx.navigate({ section: 'software', sub: panelOf(row) })
  return (
    <div className={cn('grid grid-cols-[8px_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-[11px]', selected && 'bg-nd-surface-raised')}>
      <StatusDot tone={row.tone} label={row.detail} />
      <button type="button" onClick={select} className="flex min-w-0 flex-col items-start text-left">
        <span className="truncate text-[13px] font-medium text-nd-text-primary">
          {row.entry.name} {row.version && <span className="font-mono text-xs font-normal text-nd-text-muted">{row.version}</span>}
        </span>
        <span className="truncate text-xs text-nd-text-muted">{row.detail}</span>
      </button>
      {row.update ? <Chip tone="info" dense>{row.update}</Chip> : <span />}
      {action ? (
        <Button size="sm" variant={action.primary ? 'primary' : 'secondary'} disabled={!action.onClick} onClick={action.onClick}>{action.label}</Button>
      ) : <span />}
    </div>
  )
}

function CatalogGroups({ packages, ctx, state, selected }: { packages: PackagesFacts; ctx: ServerSectionContext; state: SoftwareState; selected: string }) {
  const rows = catalogRows({ packages, php: state.phpData, usage: state.usageData })
  return (
    <div className="flex flex-col gap-3">
      {CATALOG_GROUPS.map((group) => (
        <section key={group.id} aria-label={group.label} className="overflow-hidden rounded-xl border border-nd-border bg-nd-surface">
          <div className="border-b border-nd-border px-4 py-2.5"><Label>{group.label}</Label></div>
          <div className="flex flex-col divide-y divide-nd-border">
            {rows.filter((row) => row.entry.group === group.id).map((row) => (
              <CatalogItem key={row.entry.id} row={row} ctx={ctx} state={state} selected={selected === panelOf(row)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function Catalog({ ctx, state, selected }: { ctx: ServerSectionContext; state: SoftwareState; selected: string }) {
  return (
    <ProbeState result={state.packages} label="installed software">
      {(packages) => packages.supported
        ? <CatalogGroups packages={packages} ctx={ctx} state={state} selected={selected} />
        : <Notice tone="neutral" title="Software management is unavailable on this OS">It works on Ubuntu and Debian servers.</Notice>}
    </ProbeState>
  )
}
