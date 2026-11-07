import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { OsInfo } from '@/types/server/identity'
import { installRecipe, installSupport, type ComponentId, type InstallRecipe, type InstallRequest } from '.'

const os = (family: OsInfo['family'], versionId: string, codename: string, prettyName: string): OsInfo => ({ family, id: family, versionId, codename, prettyName })

const JAMMY = os('ubuntu', '22.04', 'jammy', 'Ubuntu 22.04.5 LTS')
const NOBLE = os('ubuntu', '24.04', 'noble', 'Ubuntu 24.04.3 LTS')
const RESOLUTE = os('ubuntu', '26.04', 'resolute', 'Ubuntu 26.04 LTS')
const BOOKWORM = os('debian', '12', 'bookworm', 'Debian GNU/Linux 12 (bookworm)')
const TRIXIE = os('debian', '13', 'trixie', 'Debian GNU/Linux 13 (trixie)')
const ROCKY = os('rhel', '9.4', '', 'Rocky Linux 9.4')
const FOCAL = os('ubuntu', '20.04', 'focal', 'Ubuntu 20.04.6 LTS')
const SUPPORTED = [JAMMY, NOBLE, RESOLUTE, BOOKWORM, TRIXIE]

const ALL: ComponentId[] = ['nginx', 'apache', 'php', 'composer', 'mysql', 'mariadb', 'postgresql', 'redis', 'node', 'pm2', 'supervisor', 'certbot', 'docker', 'ufw', 'fail2ban', 'unattended-upgrades']

function steps(request: InstallRequest, target: OsInfo) {
  const recipe = installRecipe(request, target)
  if (!recipe.supported) throw new Error(recipe.reason)
  return recipe.steps
}

const scriptOf = (request: InstallRequest, target: OsInfo): string => steps(request, target).map((step) => step.script).join('\n')

const reasonOf = (recipe: InstallRecipe): string => (recipe.supported ? '' : recipe.reason)

describe('installRecipe', () => {
  it.each(SUPPORTED)('builds every component on $prettyName with a source and root steps', (target) => {
    for (const component of ALL) {
      const recipe = installRecipe({ component }, target)
      expect(recipe.supported, component).toBe(true)
      if (!recipe.supported) continue
      expect(recipe.source).toMatch(/^https:\/\//)
      for (const step of recipe.steps) {
        expect(step.root).toBe(true)
        expect(step.kind).toBe('command')
        expect(step.script.startsWith('set -e\n')).toBe(true)
        expect(step.display).not.toContain('set -e')
        expect(step.label.length).toBeGreaterThan(0)
      }
    }
  })

  it.each(SUPPORTED)('produces scripts that dash can parse on $prettyName', (target) => {
    const requests: InstallRequest[] = [...ALL.map((component) => ({ component })), { component: 'php', version: '8.5' }, { component: 'postgresql', version: '14' }, { component: 'certbot', extras: ['apache'] }]
    for (const request of requests) {
      const recipe = installRecipe(request, target)
      if (!recipe.supported) continue
      for (const step of recipe.steps) expect(() => execFileSync('dash', ['-n'], { input: step.script }), `${request.component} ${step.id}`).not.toThrow()
    }
  })

  it('runs apt steps detached with a 900 second timeout and the shared apt flags', () => {
    const [step] = steps({ component: 'nginx' }, NOBLE)
    expect(step).toMatchObject({ id: 'nginx-install', detached: true, timeoutSeconds: 900 })
    expect(step.script).toContain('export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1')
    expect(step.script).toContain('apt-get -o DPkg::Lock::Timeout=120 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold -y install nginx')
    expect(step.display).toContain('install nginx')
    expect(step.script).toContain('systemctl enable --now nginx')
  })

  it('refuses unsupported systems with a clear reason', () => {
    expect(reasonOf(installRecipe({ component: 'nginx' }, ROCKY))).toMatch(/Rocky Linux 9.4 is not supported yet/)
    expect(reasonOf(installRecipe({ component: 'nginx' }, FOCAL))).toMatch(/Ubuntu 20.04.6 LTS is not supported.*Ubuntu 22.04, Ubuntu 24.04, Ubuntu 26.04, Debian 12, Debian 13/)
    expect(reasonOf(installRecipe({ component: 'nginx' }, os('other', '3.20', '', 'Alpine Linux')))).toMatch(/Alpine Linux is not supported/)
    expect(installSupport(NOBLE)).toBeNull()
  })

  it('refuses a version for components without a version choice', () => {
    expect(reasonOf(installRecipe({ component: 'nginx', version: '1.27' }, NOBLE))).toMatch(/no version choice/)
  })

  it('refuses unknown components', () => {
    expect(installRecipe({ component: 'caddy' as ComponentId }, NOBLE).supported).toBe(false)
  })
})

describe('apache', () => {
  it('enables the modules sites need and tests the config', () => {
    const script = scriptOf({ component: 'apache' }, BOOKWORM)
    expect(script).toContain('install apache2')
    expect(script).toContain('a2enmod rewrite headers ssl proxy proxy_http proxy_fcgi setenvif')
    expect(script).toContain('apache2ctl configtest')
  })
})

describe('php', () => {
  it('uses the distro PHP without any extra source when the version ships with the release', () => {
    const list = steps({ component: 'php', version: '8.3' }, NOBLE)
    expect(list.map((step) => step.id)).toEqual(['php-install'])
    expect(list[0].script).toContain('install php8.3-fpm php8.3-cli php8.3-mbstring php8.3-xml php8.3-curl php8.3-zip php8.3-bcmath php8.3-intl php8.3-mysql php8.3-pgsql php8.3-sqlite3')
    expect(list[0].script).toContain('systemctl enable --now php8.3-fpm')
  })

  it('adds ppa:ondrej/php on Ubuntu for a version the release does not ship', () => {
    const [repo, install] = steps({ component: 'php', version: '8.4' }, NOBLE)
    expect(repo.id).toBe('php-repo')
    expect(repo.script).toContain('install software-properties-common')
    expect(repo.script).toContain('add-apt-repository -y ppa:ondrej/php')
    expect(install.script).toContain('install php8.4-fpm')
  })

  it('always adds the PPA on Ubuntu 22.04 since its own PHP 8.1 is not offered', () => {
    expect(steps({ component: 'php' }, JAMMY).map((step) => step.id)).toEqual(['php-repo', 'php-install'])
    expect(scriptOf({ component: 'php' }, JAMMY)).toContain('php8.4-fpm')
  })

  it('adds packages.sury.org with its keyring package on Debian', () => {
    const [repo] = steps({ component: 'php', version: '8.4' }, BOOKWORM)
    expect(repo.script).toContain('https://packages.sury.org/debsuryorg-archive-keyring.deb')
    expect(repo.script).toContain('dpkg -i "$keyring"')
    expect(repo.script).toContain('deb [signed-by=/usr/share/keyrings/debsuryorg-archive-keyring.gpg] https://packages.sury.org/php/ bookworm main')
    expect(repo.script).not.toContain('ondrej')
  })

  it('uses Debian 13 own PHP 8.4 without a source', () => {
    expect(steps({ component: 'php', version: '8.4' }, TRIXIE).map((step) => step.id)).toEqual(['php-install'])
  })

  it('offers only the distro PHP on Ubuntu 26.04 where the PPA has no packages yet', () => {
    expect(steps({ component: 'php', version: '8.5' }, RESOLUTE).map((step) => step.id)).toEqual(['php-install'])
    expect(reasonOf(installRecipe({ component: 'php', version: '8.3' }, RESOLUTE))).toMatch(/PHP 8.3 is not offered on Ubuntu 26.04/)
  })

  it('rejects unknown versions and extensions', () => {
    expect(reasonOf(installRecipe({ component: 'php', version: '7.4' }, NOBLE))).toMatch(/PHP 7.4 is not offered/)
    expect(reasonOf(installRecipe({ component: 'php', version: '8.3; rm -rf /' }, NOBLE))).toMatch(/not offered/)
    expect(reasonOf(installRecipe({ component: 'php', extras: ['evil'] }, NOBLE))).toMatch(/extension evil/)
  })

  it('adds requested extra extensions', () => {
    expect(scriptOf({ component: 'php', version: '8.3', extras: ['redis', 'gd'] }, NOBLE)).toContain('php8.3-sqlite3 php8.3-redis php8.3-gd')
  })
})

describe('composer', () => {
  it('reuses the checksum-checked installer for the chosen PHP', () => {
    const [step] = steps({ component: 'composer', version: '8.3' }, NOBLE)
    expect(step.script).toContain('php=php8.3')
    expect(step.script).toContain('https://composer.github.io/installer.sig')
    expect(step.script).toContain('--install-dir=/usr/local/bin --filename=composer')
    expect(step.detached).toBe(false)
  })

  it('rejects a version that is not a PHP version', () => {
    expect(installRecipe({ component: 'composer', version: 'x' }, NOBLE).supported).toBe(false)
  })
})

describe('databases', () => {
  it('installs mysql-server on Ubuntu', () => {
    const [step] = steps({ component: 'mysql' }, NOBLE)
    expect(step.script).toContain('install mysql-server')
    expect(step.label).toBe('Install MySQL')
  })

  it('installs MariaDB with a note on Debian when MySQL is asked for', () => {
    const [step] = steps({ component: 'mysql' }, BOOKWORM)
    expect(step.script).toContain('install mariadb-server')
    expect(step.label).toMatch(/MariaDB.*Debian has no MySQL package/)
  })

  it('installs the distro PostgreSQL by default', () => {
    const list = steps({ component: 'postgresql' }, NOBLE)
    expect(list.map((step) => step.id)).toEqual(['postgresql-install'])
    expect(list[0].script).toMatch(/install postgresql\n/)
  })

  it('adds PGDG with the postgresql-common script for another major', () => {
    const [repo, install] = steps({ component: 'postgresql', version: '17' }, NOBLE)
    expect(repo.script).toContain('install postgresql-common')
    expect(repo.script).toContain('/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y')
    expect(install.script).toContain('install postgresql-17')
    expect(installRecipe({ component: 'postgresql', version: '17' }, BOOKWORM)).toMatchObject({ source: 'https://www.postgresql.org/download/linux/debian/' })
  })

  it('rejects unknown PostgreSQL majors', () => {
    expect(reasonOf(installRecipe({ component: 'postgresql', version: '9' }, NOBLE))).toMatch(/PostgreSQL 9 is not offered/)
  })

  it('installs redis-server', () => {
    expect(scriptOf({ component: 'redis' }, TRIXIE)).toContain('install redis-server')
  })
})

describe('node', () => {
  it('downloads the NodeSource setup script to a temp file, runs it and installs nodejs', () => {
    const [step] = steps({ component: 'node', version: '24' }, NOBLE)
    expect(step.display).toContain('curl -fsSL https://deb.nodesource.com/setup_24.x -o "$setup_script"')
    expect(step.script).toContain('bash "$setup_script"')
    expect(step.script).toMatch(/install nodejs\n/)
  })

  it('uses setup_lts.x without a version', () => {
    expect(scriptOf({ component: 'node' }, NOBLE)).toContain('https://deb.nodesource.com/setup_lts.x')
  })

  it('refuses to install over nvm', () => {
    const script = scriptOf({ component: 'node', version: '22' }, BOOKWORM)
    expect(script.indexOf('.nvm/nvm.sh')).toBeLessThan(script.indexOf('deb.nodesource.com'))
    expect(script).toContain('exit 1')
  })

  it('rejects majors that are not current LTS lines', () => {
    expect(reasonOf(installRecipe({ component: 'node', version: '18' }, NOBLE))).toMatch(/Node.js 18 is not offered/)
  })
})

describe('tools', () => {
  it('installs pm2 with npm only when npm is on the PATH', () => {
    const script = scriptOf({ component: 'pm2' }, NOBLE)
    expect(script).toContain('command -v npm')
    expect(script).toContain('npm install -g pm2')
  })

  it('prefers the certbot snap and falls back to apt with the web server plugin', () => {
    const script = scriptOf({ component: 'certbot', extras: ['nginx'] }, BOOKWORM)
    expect(script).toContain('snap install --classic certbot')
    expect(script).toContain('ln -sf /snap/bin/certbot /usr/local/bin/certbot')
    expect(script).toContain('install certbot python3-certbot-nginx')
    expect(scriptOf({ component: 'certbot', extras: ['apache'] }, NOBLE)).toContain('install certbot python3-certbot-apache')
    expect(installRecipe({ component: 'certbot', extras: ['caddy'] }, NOBLE).supported).toBe(false)
  })

  it('installs supervisor, ufw and unattended-upgrades from the distro', () => {
    expect(scriptOf({ component: 'supervisor' }, NOBLE)).toContain('install supervisor')
    expect(scriptOf({ component: 'ufw' }, NOBLE)).toContain('install ufw')
    expect(scriptOf({ component: 'unattended-upgrades' }, BOOKWORM)).toContain('install unattended-upgrades')
  })

  it('adds python3-systemd for fail2ban on Debian only', () => {
    expect(scriptOf({ component: 'fail2ban' }, BOOKWORM)).toContain('install fail2ban python3-systemd')
    expect(scriptOf({ component: 'fail2ban' }, NOBLE)).toMatch(/install fail2ban\n/)
  })
})

describe('docker', () => {
  it('follows the official Ubuntu repo setup', () => {
    const [repo, install] = steps({ component: 'docker' }, NOBLE)
    expect(repo.script).toContain('remove $(dpkg --get-selections docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc 2>/dev/null | cut -f1)')
    expect(repo.script).toContain('curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc')
    expect(repo.script).toContain([
      'cat > /etc/apt/sources.list.d/docker.sources <<EOF',
      'Types: deb',
      'URIs: https://download.docker.com/linux/ubuntu',
      'Suites: noble',
      'Components: stable',
      'Architectures: $(dpkg --print-architecture)',
      'Signed-By: /etc/apt/keyrings/docker.asc',
      'EOF'
    ].join('\n'))
    expect(install.script).toContain('install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin')
  })

  it('uses the Debian repo and conflict list on Debian', () => {
    const [repo] = steps({ component: 'docker' }, TRIXIE)
    expect(repo.script).toContain('URIs: https://download.docker.com/linux/debian')
    expect(repo.script).toContain('Suites: trixie')
    expect(repo.script).not.toContain('docker-compose-v2')
  })
})
