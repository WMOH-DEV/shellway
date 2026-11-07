import { describe, expect, it } from 'vitest'
import type { ActionDefinition, ServerFacts } from '@/types/server/core'
import { IDENTITY_PROBE } from '@/types/server/identity'
import { softwareArea } from '../areas/software'
import { PACKAGES_UBUNTU, PHP_OUTPUT, UPDATES_UBUNTU, USAGE } from './fixtures/outputs'
import { parsePackages } from './packages'
import { parsePhp } from './php'
import { changedLines, setDirectives } from './planKit'
import { PACKAGES_PROBE, PHP_PROBE, UPDATES_PROBE, USAGE_PROBE } from './types'
import { parseUpdates } from './updates'
import { parseUsage } from './usage'

const ok = (data: unknown) => ({ status: 'ok' as const, data, at: 1 })

const identity = (family: string, prettyName = 'Ubuntu 24.04 LTS') => ok({ os: { family, id: family, versionId: '24.04', codename: 'noble', prettyName } })

const FACTS: ServerFacts = {
  [IDENTITY_PROBE]: identity('ubuntu'),
  [UPDATES_PROBE]: ok(parseUpdates(UPDATES_UBUNTU)),
  [PACKAGES_PROBE]: ok(parsePackages(PACKAGES_UBUNTU)),
  [PHP_PROBE]: ok(parsePhp(PHP_OUTPUT)),
  [USAGE_PROBE]: ok(parseUsage(USAGE))
}

const action = (type: string): ActionDefinition => {
  const found = softwareArea.actions.find((item) => item.type === type)
  if (!found) throw new Error(`missing ${type}`)
  return found
}

const plan = (type: string, raw: unknown, facts: ServerFacts = FACTS) => {
  const definition = action(type)
  return definition.plan(definition.validate(raw), facts)
}

describe('software.upgrade', () => {
  it('installs everything with upgrade --with-new-pkgs and warns about held packages', () => {
    const result = plan('software.upgrade', { mode: 'all' })
    expect(result.blocked).toBeNull()
    expect(result.steps[0].script).toContain('upgrade --with-new-pkgs')
    expect(result.steps[0].script).not.toMatch(/dist-upgrade|full-upgrade/)
    expect(result.steps[0].detached).toBe(true)
    expect(result.warnings.join(' ')).toContain('docker-ce')
  })

  it('uses unattended-upgrade for security only when it is installed', () => {
    expect(plan('software.upgrade', { mode: 'security' }).steps[0].script).toContain('unattended-upgrade -v')
  })

  it('falls back to upgrading the security packages by name', () => {
    const packages = parsePackages(PACKAGES_UBUNTU)
    const facts = { ...FACTS, [PACKAGES_PROBE]: ok({ ...packages, installed: packages.installed.filter((item) => item.name !== 'unattended-upgrades') }) }
    expect(plan('software.upgrade', { mode: 'security' }, facts).steps[0].script).toContain("install --only-upgrade 'openssl' 'libssh-4'")
  })

  it('blocks selected packages that are not in the update list', () => {
    expect(plan('software.upgrade', { mode: 'selected', packages: ['nginx', 'vim'] }).blocked?.message).toContain('vim')
  })

  it('rejects invalid package names', () => {
    expect(() => action('software.upgrade').validate({ mode: 'selected', packages: ['nginx; reboot'] })).toThrow()
  })

  it('blocks on non apt systems', () => {
    const facts = { ...FACTS, [IDENTITY_PROBE]: identity('rhel', 'Rocky Linux 9') }
    expect(plan('software.upgrade', { mode: 'all' }, facts).blocked).toEqual({ kind: 'unsupported', message: expect.stringContaining('Rocky Linux 9') })
  })
})

describe('software.restart-services', () => {
  it('restarts only services needrestart listed', () => {
    expect(plan('software.restart-services', { services: ['nginx.service'] }).steps[0].script).toBe("systemctl restart 'nginx.service'\n")
    expect(plan('software.restart-services', { services: ['sshd.service'] }).blocked?.kind).toBe('precondition')
  })
})

describe('software.install', () => {
  it('shows the install recipe reason while it is unsupported', () => {
    const result = plan('software.install', { component: 'apache' })
    expect(result.blocked?.kind).toBe('unsupported')
  })

  it('blocks a PHP version that is already installed', () => {
    expect(plan('software.install', { component: 'php', version: '8.3' }).blocked?.message).toContain('already installed')
  })

  it('requires a PHP version', () => {
    expect(() => action('software.install').validate({ component: 'php' })).toThrow()
  })
})

describe('software.remove', () => {
  it('blocks a PHP version that sites use', () => {
    expect(plan('software.remove', { component: 'php', version: '8.3' }).blocked?.message).toContain('app.example.com')
  })

  it('removes an unused PHP version', () => {
    const result = plan('software.remove', { component: 'php', version: '8.2' })
    expect(result.blocked).toBeNull()
    expect(result.steps[0].script).toContain("remove 'php8.2-fpm'")
  })

  it('blocks nginx while it serves sites', () => {
    expect(plan('software.remove', { component: 'nginx' }).blocked?.message).toContain('2 sites')
  })

  it('blocks MySQL while it holds databases', () => {
    expect(plan('software.remove', { component: 'mysql' }).blocked?.message).toContain('shop')
  })

  it('blocks a database engine when databases could not be checked', () => {
    const facts = { ...FACTS, [USAGE_PROBE]: { status: 'unavailable' as const, reason: 'no sudo', at: 1 } }
    expect(plan('software.remove', { component: 'mysql' }, facts).blocked?.message).toContain('Could not check')
  })

  it('removes every installed package of the component', () => {
    const usage = { ...parseUsage(USAGE), mysqlDatabases: [] }
    const result = plan('software.remove', { component: 'mysql' }, { ...FACTS, [USAGE_PROBE]: ok(usage) })
    expect(result.steps[0].script).toContain("remove 'mysql-server' 'mysql-server-8.0'")
  })

  it('does not offer removal for docker', () => {
    expect(() => action('software.remove').validate({ component: 'docker' })).toThrow()
  })
})

describe('software.apt-install', () => {
  it('installs one package and shows the command', () => {
    const result = plan('software.apt-install', { package: 'htop' })
    expect(result.steps[0].display).toContain("install 'htop'")
  })
})

describe('php actions', () => {
  it('installs an available extension and reloads fpm', () => {
    const result = plan('software.php-extension', { version: '8.3', extension: 'imagick', op: 'install' })
    expect(result.steps.map((step) => step.id)).toEqual(['package', 'reload'])
    expect(result.steps[1].script).toBe('systemctl reload php8.3-fpm\n')
  })

  it('blocks an extension that is not packaged', () => {
    expect(plan('software.php-extension', { version: '8.3', extension: 'swoole', op: 'install' }).blocked?.kind).toBe('precondition')
  })

  it('blocks removing an extension a site requires', () => {
    expect(plan('software.php-extension', { version: '8.3', extension: 'mbstring', op: 'remove' }).blocked?.message).toContain('app.example.com')
  })

  it('switches the CLI default with an undo to the previous version', () => {
    const facts = { ...FACTS, [PHP_PROBE]: ok({ ...parsePhp(PHP_OUTPUT), cliDefault: '8.2', versions: parsePhp(PHP_OUTPUT).versions }) }
    const result = plan('software.php-cli-default', { version: '8.3' }, facts)
    expect(result.steps[0].script).toBe('update-alternatives --set php /usr/bin/php8.3\n')
    expect(result.undo).toEqual({ type: 'software.php-cli-default', params: { version: '8.2' } })
  })

  it('writes php.ini changes to the override file with a test and reload', () => {
    const result = plan('software.php-ini', { version: '8.3', values: { memory_limit: '512M', 'date.timezone': 'Europe/Berlin' } })
    const step = result.steps[0]
    expect(step.kind).toBe('file-edit')
    expect(step.display).toContain('/etc/php/8.3/fpm/conf.d/99-shellway.ini')
    expect(step.display).toContain('php-fpm8.3 -t')
    expect(step.diff).toBe('-memory_limit = 256M\n+memory_limit = 512M\n+date.timezone = Europe/Berlin')
  })

  it('rejects unknown ini keys and bad values', () => {
    expect(() => action('software.php-ini').validate({ version: '8.3', values: { disable_functions: '' } })).toThrow()
    expect(() => action('software.php-ini').validate({ version: '8.3', values: { memory_limit: '1G; x' } })).toThrow()
  })

  it('edits pool lines in place and uncomments missing ones', () => {
    const result = plan('software.php-fpm-pool', { version: '8.3', settings: { 'pm.max_children': '20', 'pm.max_spare_servers': '6', 'pm.max_requests': '500' } })
    expect(result.blocked).toBeNull()
    expect(result.steps[0].diff).toBe('-pm.max_children = 5\n+pm.max_children = 20\n-pm.max_spare_servers = 3\n+pm.max_spare_servers = 6\n-;pm.max_requests = 500\n+pm.max_requests = 500')
  })

  it('blocks inconsistent dynamic pool settings', () => {
    expect(plan('software.php-fpm-pool', { version: '8.3', settings: { 'pm.max_children': '2' } }).blocked?.message).toContain('max children')
  })

  it('clears OPcache by reloading fpm', () => {
    expect(plan('software.opcache-reset', { version: '8.3' }).steps[0].script).toBe('systemctl reload php8.3-fpm\n')
  })
})

describe('setDirectives', () => {
  it('appends keys that are missing and keeps a trailing newline', () => {
    expect(setDirectives('', { memory_limit: '1G' })).toBe('memory_limit = 1G\n')
    expect(setDirectives('a = 1\n', { b: '2' })).toBe('a = 1\nb = 2\n')
  })

  it('produces an empty diff when nothing changes', () => {
    expect(changedLines('a = 1\n', setDirectives('a = 1\n', { a: '1' }))).toBe('')
  })
})
