import { NODE_DEFAULT, NODE_MAJORS, PHP_VERSIONS, POSTGRES_VERSIONS, defaultPhpVersion, offeredPhpVersions, type DebianRelease } from '../install/releases'
import type { ProfileId, RowChoices, RowId, SecurityChoices, SecurityId } from './types'

export interface Choice {
  value: string
  label: string
}

export interface ProfileInfo {
  id: ProfileId
  title: string
  detail: string
  on: RowId[]
}

export interface RowInfo {
  id: RowId
  title: string
  detail: string
}

export interface SecurityInfo {
  id: SecurityId
  title: string
  detail: string
}

export const PROFILES: readonly ProfileInfo[] = [
  { id: 'laravel', title: 'Laravel / PHP', detail: 'nginx, PHP-FPM, Composer, MySQL, Redis, queue workers', on: ['web', 'php', 'composer', 'database', 'redis', 'node', 'supervisor', 'certbot'] },
  { id: 'node', title: 'Node.js', detail: 'nginx proxy, Node LTS, pm2', on: ['web', 'node', 'pm2', 'certbot'] },
  { id: 'static', title: 'Static sites', detail: 'nginx and certbot only', on: ['web', 'certbot'] },
  { id: 'docker', title: 'Docker host', detail: 'Docker Engine, Compose, nginx proxy', on: ['web', 'docker', 'certbot'] },
  { id: 'custom', title: 'Custom', detail: 'start empty, pick each part', on: [] }
]

export const ROWS: readonly RowInfo[] = [
  { id: 'web', title: 'Web server', detail: 'serves your sites, proxies apps' },
  { id: 'php', title: 'PHP', detail: 'FPM + CLI, Laravel extensions' },
  { id: 'composer', title: 'Composer', detail: 'PHP dependencies' },
  { id: 'database', title: 'Database', detail: 'local database server' },
  { id: 'redis', title: 'Redis', detail: 'cache, sessions, queues' },
  { id: 'node', title: 'Node.js', detail: 'apps and asset builds (npm run build)' },
  { id: 'pm2', title: 'pm2', detail: 'keeps Node.js apps running' },
  { id: 'supervisor', title: 'Supervisor', detail: 'keeps queue workers running' },
  { id: 'certbot', title: 'certbot', detail: 'free HTTPS certificates' },
  { id: 'docker', title: 'Docker', detail: 'containers and compose stacks' }
]

export const SECURITY_ITEMS: readonly SecurityInfo[] = [
  { id: 'deployUser', title: 'Create a deploy user', detail: 'deploy, with sudo and your SSH keys, for logging in and deploying.' },
  { id: 'firewall', title: 'Firewall (ufw): allow SSH, 80, 443', detail: 'everything else closed. Your current SSH port is allowed before the firewall turns on.' },
  { id: 'fail2ban', title: 'fail2ban for SSH', detail: 'bans brute-force IPs. Your current IP is added to the ignore list.' },
  { id: 'autoUpdates', title: 'Automatic security updates', detail: 'unattended-upgrades, security only, no automatic reboots.' },
  { id: 'swap', title: 'Swap file', detail: 'prevents out-of-memory crashes during composer and npm builds.' },
  { id: 'passwordLoginOff', title: 'Turn off SSH password login', detail: 'only when this connection already logs in with an SSH key.' }
]

export const SECURITY_DEFAULTS: SecurityChoices = { deployUser: true, firewall: true, fail2ban: true, autoUpdates: true, swap: true, passwordLoginOff: false }

const single = (value: string, label: string): Choice[] => [{ value, label }]

export const postgresValue = (version: string): string => `postgresql-${version}`

export const ROW_VALUES: Record<RowId, readonly string[]> = {
  web: ['nginx', 'apache'],
  php: PHP_VERSIONS,
  composer: ['2'],
  database: ['mysql', ...POSTGRES_VERSIONS.map(postgresValue)],
  redis: ['distro'],
  node: NODE_MAJORS,
  pm2: ['latest'],
  supervisor: ['distro'],
  certbot: ['auto'],
  docker: ['stable']
}

export function rowChoices(release: DebianRelease, hasSnap: boolean): Record<RowId, Choice[]> {
  return {
    web: [{ value: 'nginx', label: 'nginx' }, { value: 'apache', label: 'Apache' }],
    php: offeredPhpVersions(release).map((version) => ({ value: version, label: version })),
    composer: single('2', 'latest 2.x'),
    database: [
      { value: 'mysql', label: release.family === 'debian' ? 'MariaDB (MySQL)' : 'MySQL' },
      ...POSTGRES_VERSIONS.map((version) => ({ value: postgresValue(version), label: `PostgreSQL ${version}` }))
    ],
    redis: single('distro', 'distro'),
    node: NODE_MAJORS.map((major) => ({ value: major, label: `${major} LTS` })),
    pm2: single('latest', 'latest'),
    supervisor: single('distro', 'distro'),
    certbot: single('auto', hasSnap ? 'snap' : 'apt'),
    docker: single('stable', 'official repo')
  }
}

function defaultValues(release: DebianRelease): Record<RowId, string> {
  return {
    web: 'nginx',
    php: defaultPhpVersion(release),
    composer: '2',
    database: 'mysql',
    redis: 'distro',
    node: NODE_DEFAULT,
    pm2: 'latest',
    supervisor: 'distro',
    certbot: 'auto',
    docker: 'stable'
  }
}

export function profileRows(profile: ProfileId, release: DebianRelease): RowChoices {
  const enabled = PROFILES.find((item) => item.id === profile)?.on ?? []
  const values = defaultValues(release)
  return Object.fromEntries(ROWS.map(({ id }) => [id, { on: enabled.includes(id), value: values[id] }])) as RowChoices
}

const GIB = 1024 ** 3

export const swapSizeGb = (memoryBytes: number): number => (memoryBytes > 16 * GIB ? 4 : 2)
