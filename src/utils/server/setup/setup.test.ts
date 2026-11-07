import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { ActionPlan, ServerFacts } from '@/types/server/core'
import { IDENTITY_PROBE, type OsInfo, type ServerIdentity } from '@/types/server/identity'
import { findRelease } from '../install/releases'
import { setupArea } from '../areas/setup'
import { SECURITY_DEFAULTS, profileRows, swapSizeGb } from './catalog'
import { planComponents } from './components'
import { isFreshServer } from './fresh'
import { FAIL2BAN_JAIL, FILES_PROBE, INVENTORY_PROBE, SUDOERS_FILE, parseFiles, parseInventory } from './inventory'
import { buildSetupPlan, setupSummary } from './plan'
import { fail2banIgnoreList, fail2banJail, firewallPorts, unattendedConfig } from './security'
import type { ProfileId, SetupFiles, SetupInventory, SetupParams } from './types'
import { validateSetupParams } from './validate'

const NOBLE: OsInfo = { family: 'ubuntu', id: 'ubuntu', versionId: '24.04', codename: 'noble', prettyName: 'Ubuntu 24.04.3 LTS' }
const BOOKWORM: OsInfo = { family: 'debian', id: 'debian', versionId: '12', codename: 'bookworm', prettyName: 'Debian GNU/Linux 12 (bookworm)' }
const ROCKY: OsInfo = { family: 'rhel', id: 'rocky', versionId: '9.4', codename: '', prettyName: 'Rocky Linux 9.4' }

const INVENTORY_OUTPUT = [
  'client=203.0.113.10',
  'port=2222',
  'user=ubuntu',
  'home=/home/ubuntu',
  'memKb=8000000',
  'swapKb=0',
  'keys=2',
  'installedAt=1762300000',
  'wwwSites=0',
  'cmd=snap',
  'pkg=ufw',
  'pkg=unattended-upgrades',
  ''
].join('\n')

const FRESH: SetupInventory = parseInventory(INVENTORY_OUTPUT)

const NO_FILES: SetupFiles = { hashes: {}, fail2banIgnore: [] }

const identity = (os: OsInfo): ServerIdentity => ({
  hostname: 'web-1', os, kernel: '6.8.0', arch: 'x86_64', virtualization: 'kvm', cpus: 4, memoryBytes: 8e9,
  uptimeSeconds: 100, primaryIp: '203.0.113.10', sshPort: 2222, user: 'ubuntu', timezone: 'UTC'
})

const ok = <T>(data: T) => ({ status: 'ok' as const, data, at: 1 })

const factsFor = (os: OsInfo, inventory: SetupInventory = FRESH, files: SetupFiles = NO_FILES): ServerFacts => ({
  [IDENTITY_PROBE]: ok(identity(os)),
  [INVENTORY_PROBE]: ok(inventory),
  [FILES_PROBE]: ok(files)
})

function paramsFor(profile: ProfileId, os: OsInfo = NOBLE, overrides: Partial<SetupParams> = {}): SetupParams {
  const release = findRelease(os)
  if (!release) throw new Error('unsupported test os')
  return { profile, rows: profileRows(profile, release), security: { ...SECURITY_DEFAULTS }, keyLogin: true, ...overrides }
}

const ids = (plan: ActionPlan): string[] => plan.steps.map((step) => step.id)

const step = (plan: ActionPlan, id: string) => {
  const found = plan.steps.find((item) => item.id === id)
  if (!found) throw new Error(`no step ${id} in ${ids(plan).join(', ')}`)
  return found
}

describe('setup probes', () => {
  it('parses the inventory', () => {
    expect(FRESH).toMatchObject({
      clientIp: '203.0.113.10', sshPort: 2222, user: 'ubuntu', home: '/home/ubuntu', memoryBytes: 8_192_000_000, swapBytes: 0,
      nvm: false, authorizedKeys: 2, deployUserExists: false, installedAt: 1762300000, wwwSites: 0,
      packages: ['ufw', 'unattended-upgrades'], commands: ['snap']
    })
  })

  it('treats a missing SSH connection and odd values as unknown', () => {
    const inventory = parseInventory('client=\nport=\nuser=root\nhome=/root\ninstalledAt=\nnvm=1\n')
    expect(inventory).toMatchObject({ clientIp: null, sshPort: null, installedAt: null, nvm: true, authorizedKeys: 0 })
  })

  it('parses managed file hashes and the current fail2ban ignore list', () => {
    const sha = 'a'.repeat(64)
    const files = parseFiles(`sha=${sha} ${SUDOERS_FILE}\nsha=${sha} /etc/passwd\nsha=nothex ${FAIL2BAN_JAIL}\nignore=127.0.0.1/8\nignore=198.51.100.7\n`)
    expect(files).toEqual({ hashes: { [SUDOERS_FILE]: sha }, fail2banIgnore: ['127.0.0.1/8', '198.51.100.7'] })
  })

  it('produces probe and plan scripts that dash can parse', () => {
    const security = { ...SECURITY_DEFAULTS, passwordLoginOff: true }
    const plan = buildSetupPlan(paramsFor('laravel', NOBLE, { security }), factsFor(NOBLE))
    const scripts = [...setupArea.probes.map((probe) => probe.script), ...plan.steps.filter((item) => item.kind === 'command').map((item) => item.script)]
    for (const script of scripts) expect(() => execFileSync('dash', ['-n'], { input: script })).not.toThrow()
  })

  it('registers the probes and the action on the area', () => {
    expect(setupArea.probes.map((probe) => [probe.id, probe.root])).toEqual([[INVENTORY_PROBE, false], [FILES_PROBE, true]])
    expect(setupArea.actions[0]).toMatchObject({ type: 'setup.run', needs: [IDENTITY_PROBE, INVENTORY_PROBE, FILES_PROBE] })
  })
})

describe('validateSetupParams', () => {
  it('accepts a preset', () => {
    expect(validateSetupParams(paramsFor('laravel'))).toEqual(paramsFor('laravel'))
  })

  it('rejects unknown profiles, values and missing fields', () => {
    expect(() => validateSetupParams({ ...paramsFor('laravel'), profile: 'wordpress' })).toThrow(/Unknown profile/)
    const rows = { ...paramsFor('laravel').rows, php: { on: true, value: '8.3; rm -rf /' } }
    expect(() => validateSetupParams({ ...paramsFor('laravel'), rows })).toThrow(/rows.php.value/)
    expect(() => validateSetupParams({ ...paramsFor('laravel'), security: { swap: true } })).toThrow(/security.deployUser/)
    expect(() => validateSetupParams({ ...paramsFor('laravel'), keyLogin: 'yes' })).toThrow(/keyLogin/)
    expect(() => validateSetupParams(null)).toThrow(/params/)
  })
})

describe('planComponents', () => {
  it('orders installs by group and skips what is installed', () => {
    const inventory = { ...FRESH, packages: [...FRESH.packages, 'nginx', 'redis-server'] }
    const plan = planComponents(paramsFor('laravel').rows, inventory)
    expect(plan.install.map((item) => item.request.component)).toEqual(['php', 'composer', 'node', 'mysql', 'supervisor', 'certbot'])
    expect(plan.alreadyInstalled).toEqual(['nginx', 'Redis'])
    expect(plan.installedRows).toEqual(['web', 'redis'])
    expect(plan.install.find((item) => item.request.component === 'certbot')?.request.extras).toEqual(['nginx'])
    expect(plan.install.find((item) => item.request.component === 'php')?.request).toEqual({ component: 'php', version: '8.3', extras: ['gd', 'redis'] })
  })

  it('refuses a second web server', () => {
    const plan = planComponents(paramsFor('static').rows, { ...FRESH, packages: ['apache2'] })
    expect(plan.problems[0]).toMatch(/Apache is already installed/)
  })

  it('needs PHP for Composer and Node.js for pm2', () => {
    const rows = { ...paramsFor('custom').rows, composer: { on: true, value: '2' }, pm2: { on: true, value: 'latest' } }
    expect(planComponents(rows, FRESH).problems).toEqual(['Composer needs PHP. Turn on PHP too.', 'pm2 needs Node.js. Turn on Node.js too.'])
  })

  it('leaves nvm-managed Node.js alone', () => {
    const plan = planComponents(paramsFor('node').rows, { ...FRESH, nvm: true })
    expect(plan.install.map((item) => item.request.component)).toEqual(['nginx', 'certbot'])
    expect(plan.notes.join(' ')).toMatch(/nvm/)
  })

  it('maps a PostgreSQL choice to its major', () => {
    const rows = { ...paramsFor('custom').rows, database: { on: true, value: 'postgresql-17' } }
    expect(planComponents(rows, FRESH).install[0].request).toEqual({ component: 'postgresql', version: '17' })
  })
})

describe('buildSetupPlan', () => {
  it('groups steps from system update to security in order', () => {
    const plan = buildSetupPlan(paramsFor('laravel'), factsFor(NOBLE))
    expect(plan.blocked).toBeNull()
    expect(ids(plan)).toEqual([
      'update.upgrade',
      'web.nginx-install',
      'languages.php-install',
      'languages.composer-install',
      'languages.node-install',
      'databases.mysql-install',
      'databases.redis-install',
      'tools.supervisor-install',
      'tools.certbot-install',
      'security.deploy-user',
      'security.deploy-sudoers',
      'security.ufw-enable',
      'security.fail2ban-install',
      'security.fail2ban-jail',
      'security.unattended-config',
      'security.swap'
    ])
    expect(step(plan, 'web.nginx-install').label).toBe('Web server · Install nginx')
    expect(step(plan, 'update.upgrade').script).toContain('upgrade --with-new-pkgs')
    expect(step(plan, 'update.upgrade').script).not.toMatch(/dist-upgrade|full-upgrade/)
    expect(plan.summary).toBe('Install 8 components and apply 5 security changes on Ubuntu 24.04.3 LTS.')
  })

  it('allows the current SSH port before turning ufw on', () => {
    const script = step(buildSetupPlan(paramsFor('static'), factsFor(NOBLE)), 'security.ufw-enable').script
    expect(script.indexOf('ufw allow 2222/tcp')).toBeLessThan(script.indexOf('ufw --force enable'))
    expect(script).toContain('ufw allow 22/tcp\nufw allow 2222/tcp\nufw allow 80/tcp\nufw allow 443/tcp')
    expect(firewallPorts(22)).toEqual([22, 80, 443])
  })

  it('blocks the firewall when the SSH port is unknown', () => {
    const plan = buildSetupPlan(paramsFor('static'), factsFor(NOBLE, { ...FRESH, sshPort: null }))
    expect(plan.blocked?.message).toMatch(/SSH port/)
  })

  it('creates the deploy user with a visudo-checked sudoers drop-in and your keys', () => {
    const plan = buildSetupPlan(paramsFor('static'), factsFor(NOBLE))
    expect(step(plan, 'security.deploy-user').script).toContain("done < '/home/ubuntu/.ssh/authorized_keys'")
    expect(step(plan, 'security.deploy-user').script).toContain('usermod -aG sudo deploy')
    expect(step(plan, 'security.deploy-sudoers')).toMatchObject({ kind: 'file-edit', root: true })
    expect(step(plan, 'security.deploy-sudoers').display).toContain('visudo -cf /etc/sudoers.d/shellway-deploy')
  })

  it('skips the deploy user when already logged in as deploy', () => {
    const plan = buildSetupPlan(paramsFor('static'), factsFor(NOBLE, { ...FRESH, user: 'deploy', home: '/home/deploy' }))
    expect(ids(plan)).not.toContain('security.deploy-user')
    expect(plan.warnings.join(' ')).toMatch(/already logged in as deploy/)
  })

  it('turns off password login only for key logins with keys present', () => {
    const security = { ...SECURITY_DEFAULTS, passwordLoginOff: true }
    const withKey = buildSetupPlan(paramsFor('static', NOBLE, { security }), factsFor(NOBLE))
    expect(step(withKey, 'security.ssh-password-off').display).toContain('sshd -t')
    expect(step(withKey, 'security.ssh-password-off').display).toContain('/etc/ssh/sshd_config.d/00-shellway.conf')
    expect(buildSetupPlan(paramsFor('static', NOBLE, { security, keyLogin: false }), factsFor(NOBLE)).blocked?.message).toMatch(/log in with an SSH key/)
    expect(buildSetupPlan(paramsFor('static', NOBLE, { security }), factsFor(NOBLE, { ...FRESH, authorizedKeys: 0 })).blocked?.message).toMatch(/lock you out/)
  })

  it('adds a swap file sized by memory unless swap is on', () => {
    expect(step(buildSetupPlan(paramsFor('static'), factsFor(NOBLE)), 'security.swap').script).toContain('fallocate -l 2G /swapfile')
    expect(ids(buildSetupPlan(paramsFor('static'), factsFor(NOBLE, { ...FRESH, swapBytes: 1 })))).not.toContain('security.swap')
    expect(swapSizeGb(32 * 1024 ** 3)).toBe(4)
  })

  it('warns that Docker ports skip ufw', () => {
    expect(buildSetupPlan(paramsFor('docker'), factsFor(NOBLE)).warnings.join(' ')).toMatch(/127\.0\.0\.1/)
  })

  it('blocks unsupported systems and missing facts', () => {
    expect(buildSetupPlan(paramsFor('static'), factsFor(ROCKY)).blocked).toMatchObject({ kind: 'unsupported' })
    expect(buildSetupPlan(paramsFor('static'), {}).blocked).toMatchObject({ kind: 'precondition' })
    const noRoot = { ...factsFor(NOBLE), [FILES_PROBE]: { status: 'unavailable' as const, reason: 'sudo needs a password', at: 1 } }
    expect(buildSetupPlan(paramsFor('static'), noRoot).blocked).toMatchObject({ kind: 'sudo' })
  })

  it('installs MariaDB on Debian when MySQL is chosen', () => {
    const plan = buildSetupPlan(paramsFor('laravel', BOOKWORM), factsFor(BOOKWORM))
    expect(step(plan, 'databases.mysql-install').script).toContain('install mariadb-server')
    expect(step(plan, 'languages.php-install').script).toContain('php8.2-fpm')
  })
})

describe('security config', () => {
  it('merges the fail2ban ignore list instead of replacing it', () => {
    const files = { hashes: {}, fail2banIgnore: ['127.0.0.1/8', '198.51.100.7', 'bad;entry'] }
    expect(fail2banIgnoreList(files, '203.0.113.10')).toEqual(['127.0.0.1/8', '198.51.100.7', '::1', '203.0.113.10'])
    expect(fail2banIgnoreList(NO_FILES, 'not-an-ip')).toEqual(['127.0.0.1/8', '::1'])
  })

  it('uses the systemd backend for fail2ban on Debian', () => {
    const params = paramsFor('static', BOOKWORM)
    expect(fail2banJail({ os: BOOKWORM, inventory: FRESH, files: NO_FILES, params })).toBe('[sshd]\nenabled = true\nport = 2222\nbackend = systemd\nignoreip = 127.0.0.1/8 ::1 203.0.113.10\n')
    expect(fail2banJail({ os: NOBLE, inventory: FRESH, files: NO_FILES, params })).not.toContain('backend')
  })

  it('limits unattended upgrades to security on Debian and never reboots', () => {
    expect(unattendedConfig(NOBLE)).toContain('Unattended-Upgrade::Automatic-Reboot "false";')
    expect(unattendedConfig(NOBLE)).not.toContain('#clear')
    expect(unattendedConfig(BOOKWORM)).toContain('#clear Unattended-Upgrade::Origins-Pattern;')
    expect(unattendedConfig(BOOKWORM)).not.toContain('label=Debian";')
  })
})

describe('setupSummary', () => {
  it('counts components, security changes and minutes', () => {
    expect(setupSummary(paramsFor('laravel'), FRESH)).toEqual({ installCount: 8, securityCount: 5, minutes: 11 })
  })
})

describe('isFreshServer', () => {
  const now = 1762300000 * 1000 + 86_400_000

  it('is fresh with no web server, no sites and a recent install', () => {
    expect(isFreshServer({ [INVENTORY_PROBE]: ok(FRESH) }, now)).toBe(true)
  })

  it('is not fresh with a web server, sites, an old install or no facts', () => {
    expect(isFreshServer({ [INVENTORY_PROBE]: ok({ ...FRESH, packages: ['nginx'] }) }, now)).toBe(false)
    expect(isFreshServer({ [INVENTORY_PROBE]: ok({ ...FRESH, wwwSites: 2 }) }, now)).toBe(false)
    expect(isFreshServer({ [INVENTORY_PROBE]: ok(FRESH) }, now + 90 * 86_400_000)).toBe(false)
    expect(isFreshServer({}, now)).toBe(false)
  })
})
