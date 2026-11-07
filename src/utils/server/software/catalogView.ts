import { BASE_TOOLS, CATALOG, ownsPackage } from './catalog'
import { installedPackage } from './packages'
import { upstreamVersion } from './sections'
import type { CatalogEntry, InstalledPackage, PackagesFacts, PhpFacts, ServiceState, UsageFacts } from './types'

export type RowTone = 'success' | 'warning' | 'error' | 'neutral'

export interface CatalogRow {
  entry: CatalogEntry
  installed: boolean
  version: string | null
  detail: string
  tone: RowTone
  update: string | null
  updatePackages: string[]
}

export interface CatalogInputs {
  packages: PackagesFacts
  php: PhpFacts | null
  usage: UsageFacts | null
}

const SERVICE_TEXT: Record<ServiceState, string> = { active: 'running', inactive: 'stopped', failed: 'failed', activating: 'starting', unknown: 'status unknown' }

const SERVICE_TONE: Record<ServiceState, RowTone> = { active: 'success', inactive: 'warning', failed: 'error', activating: 'warning', unknown: 'neutral' }

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

const NOT_INSTALLED = { installed: false, version: null, detail: 'not installed', tone: 'neutral' as RowTone, update: null, updatePackages: [] }

const ownedPackages = (entry: CatalogEntry, packages: PackagesFacts): InstalledPackage[] => packages.installed.filter((item) => ownsPackage(entry, item.name))

function usageNote(entry: CatalogEntry, { packages, usage }: CatalogInputs): string | null {
  if (entry.id === 'nginx' || entry.id === 'apache') return plural(packages.siteCounts[entry.id], 'site')
  const databases = entry.id === 'postgresql' ? usage?.postgresDatabases : entry.id === 'mysql' || entry.id === 'mariadb' ? usage?.mysqlDatabases : undefined
  return databases ? plural(databases.length, 'database') : null
}

function updateLabel(item: InstalledPackage): string {
  const next = upstreamVersion(item.candidate ?? '')
  return next === upstreamVersion(item.version) ? 'update available' : `${next} available`
}

function packageRow(entry: CatalogEntry, inputs: CatalogInputs): CatalogRow {
  const owned = ownedPackages(entry, inputs.packages)
  if (owned.length === 0) return { entry, ...NOT_INSTALLED }
  const state = entry.service ? inputs.packages.services[entry.service] ?? 'unknown' : null
  const notes = [state ? SERVICE_TEXT[state] : 'installed', usageNote(entry, inputs)].filter(Boolean)
  const upgradable = owned.filter((item) => item.candidate)
  return {
    entry,
    installed: true,
    version: upstreamVersion(owned[0].version),
    detail: notes.join(' · '),
    tone: state ? SERVICE_TONE[state] : 'success',
    update: upgradable[0] ? updateLabel(upgradable[0]) : null,
    updatePackages: upgradable.map((item) => item.name)
  }
}

function phpRow(entry: CatalogEntry, php: PhpFacts | null): CatalogRow {
  if (!php?.installed) return { entry, ...NOT_INSTALLED }
  const version = php.cliDefault ?? php.versions[0]?.version ?? null
  const detail = `${plural(php.versions.length, 'version')} · ${plural(php.sites.length, 'site')}`
  return { entry, installed: true, version, detail, tone: 'success', update: null, updatePackages: [] }
}

function simpleRow(entry: CatalogEntry, version: string | null, detail: string): CatalogRow {
  if (!version) return { entry, ...NOT_INSTALLED }
  return { entry, installed: true, version, detail, tone: 'success', update: null, updatePackages: [] }
}

const NODE_SOURCE: Record<string, string> = { nodesource: 'via NodeSource', distro: 'from the OS packages', nvm: 'via nvm', other: 'installed manually' }

function nodeRow(entry: CatalogEntry, packages: PackagesFacts): CatalogRow {
  const node = packages.node
  if (!node.source) return { entry, ...NOT_INSTALLED }
  const row = packageRow(entry, { packages, php: null, usage: null })
  const version = node.version ?? node.nvmVersions[node.nvmVersions.length - 1]?.replace(/^v/, '') ?? null
  return { ...row, installed: true, version, detail: NODE_SOURCE[node.source], tone: 'success' }
}

function certbotRow(entry: CatalogEntry, packages: PackagesFacts): CatalogRow {
  if (packages.certbotSnapVersion) return simpleRow(entry, packages.certbotSnapVersion, 'snap')
  const row = packageRow(entry, { packages, php: null, usage: null })
  return row.installed ? { ...row, detail: 'apt' } : row
}

function baseRow(entry: CatalogEntry, packages: PackagesFacts): CatalogRow {
  const missing = BASE_TOOLS.filter((name) => !installedPackage(packages, name))
  const detail = missing.length === 0 ? 'base tools' : `missing ${missing.join(', ')}`
  return { entry, installed: missing.length < BASE_TOOLS.length, version: null, detail, tone: missing.length === 0 ? 'success' : 'warning', update: null, updatePackages: [] }
}

export function catalogRow(entry: CatalogEntry, inputs: CatalogInputs): CatalogRow {
  switch (entry.id) {
    case 'php':
      return phpRow(entry, inputs.php)
    case 'composer':
      return simpleRow(entry, inputs.packages.composerVersion, 'global')
    case 'pm2':
      return simpleRow(entry, inputs.packages.node.pm2Version, 'process manager for Node apps')
    case 'node':
      return nodeRow(entry, inputs.packages)
    case 'certbot':
      return certbotRow(entry, inputs.packages)
    case 'base':
      return baseRow(entry, inputs.packages)
    default:
      return packageRow(entry, inputs)
  }
}

export const catalogRows = (inputs: CatalogInputs): CatalogRow[] => CATALOG.map((entry) => catalogRow(entry, inputs))
