import type { InstallRequest } from '../install'
import { ROWS } from './catalog'
import type { GroupId, RowChoices, RowId, SetupInventory } from './types'

export interface PlannedComponent {
  row: RowId
  group: GroupId
  request: InstallRequest
}

export interface ComponentPlan {
  install: PlannedComponent[]
  alreadyInstalled: string[]
  installedRows: RowId[]
  notes: string[]
  problems: string[]
}

type RowOutcome =
  | { kind: 'install'; request: InstallRequest }
  | { kind: 'installed'; name: string }
  | { kind: 'skip'; note: string }
  | { kind: 'problem'; message: string }

interface RowContext {
  rows: RowChoices
  inventory: SetupInventory
  value: string
}

export const GROUP_ORDER: readonly GroupId[] = ['update', 'web', 'languages', 'databases', 'tools', 'security']

const GROUP_OF: Record<RowId, GroupId> = {
  web: 'web',
  php: 'languages',
  composer: 'languages',
  node: 'languages',
  pm2: 'languages',
  database: 'databases',
  redis: 'databases',
  supervisor: 'tools',
  certbot: 'tools',
  docker: 'tools'
}

const hasPackage = (inventory: SetupInventory, ...names: string[]): boolean => names.some((name) => inventory.packages.includes(name))

const hasCommand = (inventory: SetupInventory, name: string): boolean => inventory.commands.includes(name)

const PHP_FPM = /^php(\d\.\d{1,2})-fpm$/

export const installedPhpVersions = (inventory: SetupInventory): string[] =>
  inventory.packages.flatMap((name) => PHP_FPM.exec(name)?.[1] ?? []).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))

const hasNode = (inventory: SetupInventory): boolean => hasPackage(inventory, 'nodejs') || hasCommand(inventory, 'node')

const install = (request: InstallRequest): RowOutcome => ({ kind: 'install', request })

const installed = (name: string): RowOutcome => ({ kind: 'installed', name })

const problem = (message: string): RowOutcome => ({ kind: 'problem', message })

const WEB_PACKAGES: Record<string, { package: string; label: string }> = {
  nginx: { package: 'nginx', label: 'nginx' },
  apache: { package: 'apache2', label: 'Apache' }
}

function webServer({ inventory, value }: RowContext): RowOutcome {
  const wanted = WEB_PACKAGES[value]
  if (hasPackage(inventory, wanted.package)) return installed(wanted.label)
  const other = Object.values(WEB_PACKAGES).find((item) => item !== wanted && hasPackage(inventory, item.package))
  if (other) return problem(`${other.label} is already installed. Pick ${other.label} as the web server or turn the web server off; two web servers cannot share ports 80 and 443.`)
  return install({ component: value === 'apache' ? 'apache' : 'nginx' })
}

function php({ rows, inventory, value }: RowContext): RowOutcome {
  if (hasPackage(inventory, `php${value}-fpm`)) return installed(`PHP ${value}`)
  return install({ component: 'php', version: value, extras: rows.redis.on ? ['gd', 'redis'] : ['gd'] })
}

function composer({ rows, inventory }: RowContext): RowOutcome {
  if (hasCommand(inventory, 'composer')) return installed('Composer')
  const version = rows.php.on ? rows.php.value : installedPhpVersions(inventory)[0]
  if (!version) return problem('Composer needs PHP. Turn on PHP too.')
  return install({ component: 'composer', version })
}

function database({ inventory, value }: RowContext): RowOutcome {
  if (value === 'mysql') {
    if (hasPackage(inventory, 'mysql-server')) return installed('MySQL')
    if (hasPackage(inventory, 'mariadb-server')) return installed('MariaDB')
    return install({ component: 'mysql' })
  }
  const version = value.replace('postgresql-', '')
  if (hasPackage(inventory, value)) return installed(`PostgreSQL ${version}`)
  return install({ component: 'postgresql', version })
}

function node({ inventory, value }: RowContext): RowOutcome {
  if (inventory.nvm) return { kind: 'skip', note: `Node.js is managed with nvm for ${inventory.user}, so Shellway leaves it alone.` }
  if (hasNode(inventory)) return installed('Node.js')
  return install({ component: 'node', version: value })
}

function pm2({ rows, inventory }: RowContext): RowOutcome {
  if (hasCommand(inventory, 'pm2')) return installed('pm2')
  if (inventory.nvm) return { kind: 'skip', note: "pm2 is skipped because Node.js is managed with nvm. Install it with that user's npm." }
  if (!rows.node.on && !hasNode(inventory)) return problem('pm2 needs Node.js. Turn on Node.js too.')
  return install({ component: 'pm2' })
}

function certbotPlugin({ rows, inventory }: RowContext): string[] {
  if (rows.web.on) return [rows.web.value]
  if (hasPackage(inventory, 'nginx')) return ['nginx']
  return hasPackage(inventory, 'apache2') ? ['apache'] : []
}

function certbot(context: RowContext): RowOutcome {
  if (hasPackage(context.inventory, 'certbot') || hasCommand(context.inventory, 'certbot')) return installed('certbot')
  return install({ component: 'certbot', extras: certbotPlugin(context) })
}

const distro = (component: 'redis' | 'supervisor', packageName: string, name: string) => ({ inventory }: RowContext): RowOutcome =>
  hasPackage(inventory, packageName) ? installed(name) : install({ component })

function docker({ inventory }: RowContext): RowOutcome {
  if (hasPackage(inventory, 'docker-ce', 'docker.io') || hasCommand(inventory, 'docker')) return installed('Docker')
  return install({ component: 'docker' })
}

const RESOLVERS: Record<RowId, (context: RowContext) => RowOutcome> = {
  web: webServer,
  php,
  composer,
  database,
  redis: distro('redis', 'redis-server', 'Redis'),
  node,
  pm2,
  supervisor: distro('supervisor', 'supervisor', 'Supervisor'),
  certbot,
  docker
}

const byGroup = (a: PlannedComponent, b: PlannedComponent): number => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)

export function planComponents(rows: RowChoices, inventory: SetupInventory): ComponentPlan {
  const plan: ComponentPlan = { install: [], alreadyInstalled: [], installedRows: [], notes: [], problems: [] }
  for (const { id } of ROWS) {
    if (!rows[id].on) continue
    const outcome = RESOLVERS[id]({ rows, inventory, value: rows[id].value })
    if (outcome.kind === 'install') plan.install.push({ row: id, group: GROUP_OF[id], request: outcome.request })
    if (outcome.kind === 'installed') {
      plan.alreadyInstalled.push(outcome.name)
      plan.installedRows.push(id)
    }
    if (outcome.kind === 'skip') plan.notes.push(outcome.note)
    if (outcome.kind === 'problem') plan.problems.push(outcome.message)
  }
  plan.install.sort(byGroup)
  return plan
}
