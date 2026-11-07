import { vhostFor } from './inventory'
import { siteFile, siteStack, type SiteEntry } from './join'
import { LARAVEL_LOG } from './logs'
import type { SiteLogSource, SitesInventory } from './types'
import { vhostLogs, vhostServer } from './vhost'

export interface LogSourceOption {
  id: string
  label: string
  source: SiteLogSource
  file: string
}

const PHP_STACKS = new Set(['laravel', 'php'])

export function logSources(entry: SiteEntry, inventory: SitesInventory | null): LogSourceOption[] {
  const options: LogSourceOption[] = []
  if (PHP_STACKS.has(siteStack(entry.summary))) options.push({ id: 'app', label: 'laravel.log', source: 'app', file: LARAVEL_LOG })
  const file = siteFile(entry)
  const vhost = file ? vhostFor(inventory, file) : undefined
  const server = vhostServer(vhost?.realPath ?? file ?? '')
  if (!server) return options
  const logs = vhostLogs(vhost?.content ?? '', server)
  const label = server.kind === 'nginx' ? 'nginx' : 'Apache'
  options.push({ id: 'error', label: `${label} error`, source: 'error', file: logs.error }, { id: 'access', label: 'access', source: 'access', file: logs.access })
  return options
}
