import { CATALOG } from '@/utils/server/software/catalog'
import type { CatalogEntry } from '@/utils/server/software/types'
import type { ServerSectionContext } from '../types'
import { ComponentPanel, DatabasePanel, NodePanel } from './ComponentPanels'
import { NginxPanel } from './NginxPanel'
import { PhpPanel } from './PhpPanel'
import type { SoftwareState } from './useSoftware'

const DATABASE_PANELS = new Set(['mysql', 'mariadb', 'postgresql'])

const entryForPanel = (panel: string): CatalogEntry | undefined => CATALOG.find((entry) => (entry.panel ?? entry.id) === panel)

export function DetailPanel({ panel, ctx, state }: { panel: string; ctx: ServerSectionContext; state: SoftwareState }) {
  if (panel === 'php') return <PhpPanel ctx={ctx} state={state} />
  const entry = entryForPanel(panel)
  const packages = state.packagesData
  if (!entry || !packages?.supported) return null
  if (panel === 'nginx') return <NginxPanel entry={entry} packages={packages} state={state} />
  if (panel === 'node') return <NodePanel entry={entry} packages={packages} ctx={ctx} state={state} />
  if (DATABASE_PANELS.has(panel)) return <DatabasePanel entry={entry} packages={packages} ctx={ctx} state={state} />
  return <ComponentPanel entry={entry} packages={packages} ctx={ctx} state={state} />
}
