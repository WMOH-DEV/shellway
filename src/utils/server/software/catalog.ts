import type { CatalogEntry, CatalogGroup } from './types'

export const CATALOG_GROUPS: { id: CatalogGroup; label: string }[] = [
  { id: 'web', label: 'Web servers' },
  { id: 'languages', label: 'Languages' },
  { id: 'databases', label: 'Databases & cache' },
  { id: 'tools', label: 'Containers & tools' }
]

export const BASE_TOOLS = ['git', 'curl', 'unzip', 'htop']

export const CATALOG: CatalogEntry[] = [
  { id: 'nginx', name: 'nginx', group: 'web', packages: ['nginx', 'nginx-core', 'nginx-full', 'nginx-light', 'nginx-extras'], service: 'nginx', component: 'nginx', removable: true },
  { id: 'apache', name: 'Apache', group: 'web', packages: ['apache2'], service: 'apache2', component: 'apache', removable: true },
  { id: 'php', name: 'PHP', group: 'languages', packages: [], component: 'php', panel: 'php' },
  { id: 'composer', name: 'Composer', group: 'languages', packages: [], component: 'composer' },
  { id: 'node', name: 'Node.js', group: 'languages', packages: ['nodejs'], component: 'node', panel: 'node' },
  { id: 'pm2', name: 'pm2', group: 'languages', packages: [], component: 'pm2', panel: 'node' },
  { id: 'mysql', name: 'MySQL', group: 'databases', packages: ['mysql-server'], glob: 'mysql-server-[0-9]*', match: /^mysql-server-\d/, service: 'mysql', component: 'mysql', removable: true, panel: 'mysql' },
  { id: 'mariadb', name: 'MariaDB', group: 'databases', packages: ['mariadb-server'], glob: 'mariadb-server-[0-9]*', match: /^mariadb-server-\d/, service: 'mariadb', component: 'mariadb', removable: true, panel: 'mariadb' },
  { id: 'postgresql', name: 'PostgreSQL', group: 'databases', packages: [], glob: 'postgresql-[0-9]*', match: /^postgresql-\d+$/, service: 'postgresql', component: 'postgresql', removable: true, panel: 'postgresql' },
  { id: 'redis', name: 'Redis', group: 'databases', packages: ['redis-server'], service: 'redis-server', component: 'redis', removable: true },
  { id: 'docker', name: 'Docker', group: 'tools', packages: ['docker-ce', 'docker.io'], service: 'docker', component: 'docker' },
  { id: 'certbot', name: 'certbot', group: 'tools', packages: ['certbot'], component: 'certbot' },
  { id: 'supervisor', name: 'Supervisor', group: 'tools', packages: ['supervisor'], service: 'supervisor', component: 'supervisor', removable: true },
  { id: 'ufw', name: 'ufw', group: 'tools', packages: ['ufw'], component: 'ufw' },
  { id: 'fail2ban', name: 'fail2ban', group: 'tools', packages: ['fail2ban'], service: 'fail2ban', component: 'fail2ban', removable: true },
  { id: 'unattended-upgrades', name: 'Automatic security updates', group: 'tools', packages: ['unattended-upgrades'], component: 'unattended-upgrades' },
  { id: 'base', name: BASE_TOOLS.join(', '), group: 'tools', packages: BASE_TOOLS }
]

export const catalogEntry = (id: string): CatalogEntry | undefined => CATALOG.find((entry) => entry.id === id)

export const catalogPackageNames = (): string[] => [...new Set(CATALOG.flatMap((entry) => entry.packages))]

export const catalogGlobs = (): string[] => CATALOG.flatMap((entry) => (entry.glob ? [entry.glob] : []))

export const ownsPackage = (entry: CatalogEntry, name: string): boolean => entry.packages.includes(name) || (entry.match?.test(name) ?? false)

export const catalogServices = (): string[] => CATALOG.flatMap((entry) => (entry.service ? [entry.service] : []))
