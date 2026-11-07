import { describe, expect, it } from 'vitest'
import { PACKAGES_NVM, PACKAGES_UBUNTU, PHP_OUTPUT, POOL_SHA, UPDATES_DEBIAN, UPDATES_UBUNTU, USAGE, WWW_CONF } from './fixtures/outputs'
import { bindingsFor, isPublicBinding, parsePackages } from './packages'
import { parsePhp, parsePoolSettings } from './php'
import { parseSearch, searchScript, assertSearchQuery } from './search'
import { upstreamVersion } from './sections'
import { daysSinceCheck, parseInstLine, parseUpdates, securityUpdates } from './updates'
import { parseUsage } from './usage'

describe('parseUpdates', () => {
  it('reads upgrades, security flags, holds, reboot and needrestart on Ubuntu', () => {
    const facts = parseUpdates(UPDATES_UBUNTU)
    expect(facts.supported).toBe(true)
    expect(facts.packages.map((item) => item.name)).toEqual(['openssl', 'libssh-4', 'nginx', 'php8.3-fpm'])
    expect(securityUpdates(facts).map((item) => item.name)).toEqual(['openssl', 'libssh-4'])
    expect(facts.packages[2]).toEqual({ name: 'nginx', from: '1.24.0-2ubuntu7.1', to: '1.24.0-2ubuntu7.3', security: false })
    expect(facts.held).toEqual(['docker-ce'])
    expect(facts.rebootRequired).toBe(true)
    expect(facts.rebootPackages).toEqual(['linux-image-6.8.0-47-generic', 'linux-base'])
    expect(facts.needRestart).toEqual({ installed: true, services: ['nginx.service', 'php8.3-fpm.service'], kernel: 'pending' })
    expect(daysSinceCheck(facts)).toBe(19)
  })

  it('reads Debian security origins, new packages and missing needrestart', () => {
    const facts = parseUpdates(UPDATES_DEBIAN)
    expect(facts.packages).toEqual([
      { name: 'libc6', from: '2.36-9+deb12u7', to: '2.36-9+deb12u9', security: true },
      { name: 'tzdata', from: '', to: '2024b-0+deb12u1', security: false }
    ])
    expect(facts.rebootRequired).toBe(false)
    expect(facts.checkedAt).toBeNull()
    expect(daysSinceCheck(facts)).toBeNull()
    expect(facts.needRestart.installed).toBe(false)
  })

  it('marks servers without apt as unsupported', () => {
    expect(parseUpdates('@@unsupported\n').supported).toBe(false)
    expect(parseUpdates('').supported).toBe(false)
  })

  it('ignores lines that are not Inst lines', () => {
    expect(parseInstLine('Conf openssl (3.0.13 Ubuntu:24.04/noble-updates [amd64])')).toBeNull()
  })
})

describe('parsePackages', () => {
  it('keeps only installed packages and attaches newer candidates', () => {
    const facts = parsePackages(PACKAGES_UBUNTU)
    expect(facts.supported).toBe(true)
    const names = facts.installed.map((item) => item.name)
    expect(names).toContain('mysql-server-8.0')
    expect(names).not.toContain('apache2')
    expect(names).not.toContain('nginx-core')
    expect(facts.installed.find((item) => item.name === 'nginx')).toEqual({ name: 'nginx', version: '1.24.0-2ubuntu7.1', candidate: '1.24.0-2ubuntu7.3' })
    expect(facts.installed.find((item) => item.name === 'nodejs')?.candidate).toBeNull()
    expect(facts.installed.find((item) => item.name === 'mysql-server')?.candidate).toBeNull()
  })

  it('reads services, tools, node source and site counts without default sites', () => {
    const facts = parsePackages(PACKAGES_UBUNTU)
    expect(facts.services.nginx).toBe('active')
    expect(facts.services['redis-server']).toBe('failed')
    expect(facts.composerVersion).toBe('2.8.1')
    expect(facts.certbotSnapVersion).toBe('2.11.0')
    expect(facts.node).toEqual({ version: '20.18.0', source: 'nodesource', nvmVersions: [], pm2Version: '5.4.2' })
    expect(facts.siteCounts).toEqual({ nginx: 2, apache: 0 })
    expect(bindingsFor(facts, 3306)).toEqual(['127.0.0.1:3306'])
    expect(bindingsFor(facts, 6379).map(isPublicBinding)).toEqual([true])
    expect(bindingsFor(facts, 3306).map(isPublicBinding)).toEqual([false])
  })

  it('detects nvm when node is not a system package', () => {
    const facts = parsePackages(PACKAGES_NVM)
    expect(facts.node).toEqual({ version: null, source: 'nvm', nvmVersions: ['v18.20.4', 'v20.18.0'], pm2Version: null })
    expect(facts.composerVersion).toBeNull()
  })

  it('marks servers without dpkg as unsupported', () => {
    expect(parsePackages('@@unsupported\n').supported).toBe(false)
  })
})

describe('upstreamVersion', () => {
  it.each([
    ['1.24.0-2ubuntu7.1', '1.24.0'],
    ['5:27.3.1-1~ubuntu.24.04~noble', '27.3.1'],
    ['8.0.40-0ubuntu0.24.04.1', '8.0.40'],
    ['2.11.0', '2.11.0'],
    ['1:2.43.0-1ubuntu7.1', '2.43.0'],
    ['2.9.1+nmu4ubuntu1', '2.9.1']
  ])('%s -> %s', (input, expected) => expect(upstreamVersion(input)).toBe(expected))
})

describe('parsePhp', () => {
  const facts = parsePhp(PHP_OUTPUT)

  it('lists versions newest first with the CLI default and installable versions', () => {
    expect(facts.installed).toBe(true)
    expect(facts.versions.map((item) => item.version)).toEqual(['8.3', '8.2'])
    expect(facts.cliDefault).toBe('8.3')
    expect(facts.installable).toEqual(['8.4', '8.1'])
  })

  it('normalizes modules and reads packages, ini values and the pool file', () => {
    const v83 = facts.versions[0]
    expect(v83.fpm).toBe(true)
    expect(v83.cli).toBe(true)
    expect(v83.fpmState).toBe('active')
    expect(v83.modules).toEqual(['bcmath', 'core', 'curl', 'mbstring', 'opcache', 'pdo_mysql', 'xml'])
    expect(v83.packages).toContain('php8.3-mysql')
    expect(v83.available).toContain('php8.3-imagick')
    expect(v83.ini.memory_limit).toBe('256M')
    expect(v83.ini['date.timezone']).toBe('')
    expect(v83.poolFile).toEqual({ sha256: POOL_SHA, content: WWW_CONF })
    expect(v83.pool).toEqual({ pm: 'dynamic', 'pm.max_children': '5', 'pm.start_servers': '2', 'pm.min_spare_servers': '1', 'pm.max_spare_servers': '3' })
    expect(v83.override.content).toBe('memory_limit = 256M\n')
  })

  it('handles a version without CLI, pool or override', () => {
    const v82 = facts.versions[1]
    expect(v82.cli).toBe(false)
    expect(v82.poolFile).toBeNull()
    expect(v82.override).toEqual({ sha256: null, content: '' })
  })

  it('reads which sites use which version and their required extensions', () => {
    expect(facts.sites).toEqual([
      { version: '8.3', name: 'app.example.com', extensions: ['imagick', 'mbstring', 'pdo_mysql'] },
      { version: '8.3', name: 'api.example.com', extensions: [] }
    ])
  })

  it('reports no PHP when /etc/php is missing', () => {
    expect(parsePhp('@@none\n')).toEqual({ installed: false, cliDefault: null, versions: [], installable: [], sites: [] })
  })

  it('ignores commented pool lines', () => {
    expect(parsePoolSettings(';pm.max_children = 50\npm.max_children = 8\n')).toEqual({ 'pm.max_children': '8' })
  })
})

describe('parseUsage', () => {
  it('lists user databases and fpm pressure per version', () => {
    const facts = parseUsage(USAGE)
    expect(facts.mysqlDatabases).toEqual(['shop'])
    expect(facts.postgresDatabases).toEqual(['app'])
    expect(facts.fpmPressure).toEqual([
      { version: '8.3', hits: 4, last: '07-Nov-2026 10:12:01' },
      { version: '8.2', hits: 0, last: null }
    ])
  })

  it('returns null when an engine could not be checked', () => {
    expect(parseUsage('')).toEqual({ mysqlDatabases: null, postgresDatabases: null, fpmPressure: [] })
  })
})

describe('package search', () => {
  it('validates the query', () => {
    expect(assertSearchQuery(' Redis ')).toBe('redis')
    expect(() => assertSearchQuery('re')).toThrow()
    expect(() => assertSearchQuery("x'; rm -rf /")).toThrow()
  })

  it('quotes the query in the script', () => {
    expect(searchScript('php8.3-redis')).toContain("apt-cache search --names-only -- 'php8.3-redis'")
  })

  it('parses results and installed flags', () => {
    const output = '@@results\nredis-server - Persistent key-value database\nredis-tools - Persistent key-value database (client)\n@@installed\nredis-tools\n'
    expect(parseSearch(output)).toEqual([
      { name: 'redis-server', description: 'Persistent key-value database', installed: false },
      { name: 'redis-tools', description: 'Persistent key-value database (client)', installed: true }
    ])
    expect(parseSearch('@@unsupported\n')).toBeNull()
  })
})
