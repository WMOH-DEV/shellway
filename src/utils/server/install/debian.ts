import type { ActionStep } from '@/types/server/core'
import type { OsInfo } from '@/types/server/identity'
import { installComposerScript, newPhpPackages } from '../../createSite/php'
import { APT_ENV, APT_GET, APT_INSTALL } from '../apt'
import { NODE_DEFAULT, NODE_MAJORS, POSTGRES_VERSIONS, defaultPhpVersion, findRelease, offeredPhpVersions, releaseSupport, type DebianRelease } from './releases'
import { LONG, SHORT, aptInstall, aptUpdate, enableService, rootStep, unsupported, withSystemd } from './steps'
import type { ComponentId, InstallRecipe, InstallRequest } from './types'

type ComponentBuilder = (request: InstallRequest, release: DebianRelease) => InstallRecipe

export const APACHE_MODULES = ['rewrite', 'headers', 'ssl', 'proxy', 'proxy_http', 'proxy_fcgi', 'setenvif']

export const PHP_EXTRA_EXTENSIONS = ['gd', 'redis', 'imagick', 'soap', 'gmp', 'memcached', 'apcu', 'igbinary', 'imap', 'ldap', 'readline']

const CERTBOT_PLUGINS: Record<string, string> = { nginx: 'python3-certbot-nginx', apache: 'python3-certbot-apache' }

const DOCKER_PACKAGES = ['docker-ce', 'docker-ce-cli', 'containerd.io', 'docker-buildx-plugin', 'docker-compose-plugin']

const DOCKER_CONFLICTS: Record<DebianRelease['family'], string[]> = {
  ubuntu: ['docker.io', 'docker-compose', 'docker-compose-v2', 'docker-doc', 'docker-buildx', 'podman-docker', 'containerd', 'runc'],
  debian: ['docker.io', 'docker-compose', 'docker-doc', 'docker-buildx', 'podman-docker', 'containerd', 'runc']
}

const packagePage = (release: DebianRelease, name: string): string =>
  release.family === 'ubuntu' ? `https://packages.ubuntu.com/${release.codename}/${name}` : `https://packages.debian.org/${release.codename}/${name}`

const supported = (steps: ActionStep[], source: string): InstallRecipe => ({ supported: true, steps, source })

function distroPackage(id: ComponentId, label: string, packages: string[], unit?: string): ComponentBuilder {
  return (_request, release) => supported(
    [rootStep(`${id}-install`, label, [...aptInstall(packages), ...(unit ? [enableService(unit)] : [])])],
    packagePage(release, packages[0])
  )
}

const apache: ComponentBuilder = (_request, release) => supported(
  [rootStep('apache-install', 'Install Apache', [
    ...aptInstall(['apache2']),
    `a2enmod ${APACHE_MODULES.join(' ')}`,
    'apache2ctl configtest',
    withSystemd('systemctl enable apache2 && systemctl restart apache2')
  ])],
  packagePage(release, 'apache2')
)

function phpRepoStep(release: DebianRelease): ActionStep {
  if (release.phpRepo === 'ondrej') {
    return rootStep('php-repo', 'Add the ondrej/php package source', [
      ...aptInstall(['software-properties-common']),
      'LC_ALL=C.UTF-8 add-apt-repository -y ppa:ondrej/php'
    ])
  }
  return rootStep('php-repo', 'Add the packages.sury.org PHP package source', [
    ...aptInstall(['ca-certificates', 'curl']),
    'keyring=$(mktemp --suffix=.deb)',
    'curl -sSLo "$keyring" https://packages.sury.org/debsuryorg-archive-keyring.deb',
    'dpkg -i "$keyring"',
    'rm -f "$keyring"',
    `echo "deb [signed-by=/usr/share/keyrings/debsuryorg-archive-keyring.gpg] https://packages.sury.org/php/ ${release.codename} main" > /etc/apt/sources.list.d/php.list`
  ])
}

const phpSource = (release: DebianRelease, fromRepo: boolean): string => {
  if (!fromRepo) return packagePage(release, 'php')
  return release.phpRepo === 'ondrej' ? 'https://launchpad.net/~ondrej/+archive/ubuntu/php' : 'https://packages.sury.org/php/README.txt'
}

const php: ComponentBuilder = (request, release) => {
  const version = request.version ?? defaultPhpVersion(release)
  if (!offeredPhpVersions(release).includes(version)) return unsupported(`PHP ${version} is not offered on ${release.name}. Pick one of ${offeredPhpVersions(release).join(', ')}.`)
  const extras = request.extras ?? []
  const unknown = extras.find((name) => !PHP_EXTRA_EXTENSIONS.includes(name))
  if (unknown) return unsupported(`The PHP extension ${unknown} is not offered.`)
  const fromRepo = version !== release.php
  const packages = [...newPhpPackages(version), ...extras.map((name) => `php${version}-${name}`)]
  const install = rootStep('php-install', `Install PHP ${version} with FPM and common extensions`, [...aptInstall(packages), enableService(`php${version}-fpm`)])
  return supported(fromRepo ? [phpRepoStep(release), install] : [install], phpSource(release, fromRepo))
}

const composer: ComponentBuilder = (request, release) => {
  const version = request.version ?? defaultPhpVersion(release)
  if (!/^\d\.\d{1,2}$/.test(version)) return unsupported(`${version} is not a PHP version.`)
  return supported(
    [rootStep('composer-install', 'Install Composer into /usr/local/bin (checksum checked)', installComposerScript(version).split('\n'), SHORT)],
    'https://getcomposer.org/doc/faqs/how-to-install-composer-programmatically.md'
  )
}

const mysqlOnUbuntu = distroPackage('mysql', 'Install MySQL', ['mysql-server'], 'mysql')

const mariadbForMysqlOnDebian = distroPackage('mysql', "Install MariaDB (Debian's MySQL-compatible server; Debian has no MySQL package)", ['mariadb-server'], 'mariadb')

const mysql: ComponentBuilder = (request, release) =>
  release.family === 'debian' ? mariadbForMysqlOnDebian(request, release) : mysqlOnUbuntu(request, release)

const postgresSource = (release: DebianRelease): string => `https://www.postgresql.org/download/linux/${release.family}/`

const postgresql: ComponentBuilder = (request, release) => {
  const version = request.version ?? release.postgresql
  if (version === release.postgresql) return distroPackage('postgresql', `Install PostgreSQL ${version}`, ['postgresql'], 'postgresql')(request, release)
  if (!POSTGRES_VERSIONS.includes(version)) return unsupported(`PostgreSQL ${version} is not offered. Pick one of ${POSTGRES_VERSIONS.join(', ')}.`)
  return supported([
    rootStep('postgresql-repo', 'Add the apt.postgresql.org package source', [...aptInstall(['postgresql-common']), '/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y']),
    rootStep('postgresql-install', `Install PostgreSQL ${version}`, [...aptInstall([`postgresql-${version}`]), enableService('postgresql')])
  ], postgresSource(release))
}

const NVM_GUARD = [
  'for nvm_script in /root/.nvm/nvm.sh /home/*/.nvm/nvm.sh; do',
  '  if [ -s "$nvm_script" ]; then echo "Node.js is managed with nvm on this server ($nvm_script). Shellway does not install a second copy." >&2; exit 1; fi',
  'done'
]

const NODESOURCE_KEYRING = '/usr/share/keyrings/nodesource.gpg'

const nodeRepoLines = (major: string): string[] => [
  ...aptInstall(['ca-certificates', 'curl', 'gnupg']),
  `curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o ${NODESOURCE_KEYRING}`,
  `chmod a+r ${NODESOURCE_KEYRING}`,
  'rm -f /etc/apt/sources.list.d/nodesource.list',
  'cat > /etc/apt/sources.list.d/nodesource.sources <<EOF',
  'Types: deb',
  `URIs: https://deb.nodesource.com/node_${major}.x`,
  'Suites: nodistro',
  'Components: main',
  `Signed-By: ${NODESOURCE_KEYRING}`,
  'EOF',
  'cat > /etc/apt/preferences.d/nodejs <<EOF',
  'Package: nodejs',
  'Pin: origin deb.nodesource.com',
  'Pin-Priority: 600',
  'EOF'
]

const node: ComponentBuilder = (request) => {
  const major = request.version ?? 'lts'
  if (major !== 'lts' && !NODE_MAJORS.includes(major)) return unsupported(`Node.js ${major} is not offered. Pick one of ${NODE_MAJORS.join(', ')}.`)
  return supported([rootStep('node-install', `Install Node.js ${major === 'lts' ? 'LTS' : major} from NodeSource`, [
    ...NVM_GUARD,
    ...nodeRepoLines(major === 'lts' ? NODE_DEFAULT : major),
    ...aptInstall(['nodejs'])
  ])], 'https://github.com/nodesource/distributions')
}

const pm2: ComponentBuilder = () => supported([rootStep('pm2-install', 'Install pm2 with npm', [
  'if ! command -v npm >/dev/null 2>&1; then',
  "  echo 'npm is not on the PATH for root (Node.js may be installed with nvm). Run npm install -g pm2 yourself, then Retry.' >&2",
  '  exit 1',
  'fi',
  'npm install -g pm2'
], { detached: true, timeoutSeconds: 600 })], 'https://pm2.keymetrics.io/docs/usage/quick-start/')

const certbot: ComponentBuilder = (request) => {
  const extras = request.extras ?? []
  const unknown = extras.find((name) => !(name in CERTBOT_PLUGINS))
  if (unknown) return unsupported(`certbot has no ${unknown} plugin.`)
  const plugins = extras.map((name) => CERTBOT_PLUGINS[name])
  return supported([rootStep('certbot-install', 'Install certbot (snap when available, else apt)', [
    APT_ENV,
    'if command -v snap >/dev/null 2>&1; then',
    `  ${APT_GET} remove certbot`,
    '  snap install --classic certbot',
    '  ln -sf /snap/bin/certbot /usr/local/bin/certbot',
    'else',
    `  ${APT_GET} update`,
    `  ${APT_INSTALL} ${['certbot', ...plugins].join(' ')}`,
    'fi'
  ])], 'https://certbot.eff.org/instructions?ws=nginx&os=snap')
}

const dockerRepoLines = (release: DebianRelease): string[] => [
  ...aptUpdate(),
  `${APT_GET} remove $(dpkg --get-selections ${DOCKER_CONFLICTS[release.family].join(' ')} 2>/dev/null | cut -f1)`,
  `${APT_INSTALL} ca-certificates curl`,
  'rm -f /etc/apt/sources.list.d/docker.list',
  'install -m 0755 -d /etc/apt/keyrings',
  `curl -fsSL https://download.docker.com/linux/${release.family}/gpg -o /etc/apt/keyrings/docker.asc`,
  'chmod a+r /etc/apt/keyrings/docker.asc',
  'cat > /etc/apt/sources.list.d/docker.sources <<EOF',
  'Types: deb',
  `URIs: https://download.docker.com/linux/${release.family}`,
  `Suites: ${release.codename}`,
  'Components: stable',
  'Architectures: $(dpkg --print-architecture)',
  'Signed-By: /etc/apt/keyrings/docker.asc',
  'EOF'
]

const docker: ComponentBuilder = (_request, release) => supported([
  rootStep('docker-repo', 'Remove conflicting packages and add the Docker package source', dockerRepoLines(release)),
  rootStep('docker-install', 'Install Docker Engine, Buildx and Compose', [...aptInstall(DOCKER_PACKAGES), enableService('docker')])
], `https://docs.docker.com/engine/install/${release.family}/`)

const fail2banOnUbuntu = distroPackage('fail2ban', 'Install fail2ban', ['fail2ban'], 'fail2ban')

const fail2banOnDebian = distroPackage('fail2ban', 'Install fail2ban', ['fail2ban', 'python3-systemd'], 'fail2ban')

const fail2ban: ComponentBuilder = (request, release) =>
  release.family === 'debian' ? fail2banOnDebian(request, release) : fail2banOnUbuntu(request, release)

const BUILDERS: Record<ComponentId, ComponentBuilder> = {
  nginx: distroPackage('nginx', 'Install nginx', ['nginx'], 'nginx'),
  apache,
  php,
  composer,
  mysql,
  mariadb: distroPackage('mariadb', 'Install MariaDB', ['mariadb-server'], 'mariadb'),
  postgresql,
  redis: distroPackage('redis', 'Install Redis', ['redis-server'], 'redis-server'),
  node,
  pm2,
  supervisor: distroPackage('supervisor', 'Install Supervisor', ['supervisor'], 'supervisor'),
  certbot,
  docker,
  ufw: distroPackage('ufw', 'Install ufw', ['ufw']),
  fail2ban,
  'unattended-upgrades': distroPackage('unattended-upgrades', 'Install unattended-upgrades', ['unattended-upgrades'])
}

const VERSIONED: ReadonlySet<ComponentId> = new Set(['php', 'composer', 'postgresql', 'node'])

export function debianRecipe(request: InstallRequest, os: OsInfo): InstallRecipe {
  const release = findRelease(os)
  if (!release) return unsupported(releaseSupport(os) ?? `${os.prettyName} is not supported.`)
  const build = BUILDERS[request.component]
  if (!build) return unsupported(`${request.component} cannot be installed by Shellway.`)
  if (request.version !== undefined && !VERSIONED.has(request.component)) return unsupported(`${request.component} has no version choice; it installs the version ${release.name} ships.`)
  return build(request, release)
}
