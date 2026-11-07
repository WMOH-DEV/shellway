import { describe, expect, it } from 'vitest'
import { makeRecord, makeSummary } from '@/utils/deploy/testSummary'
import { makeBlock, makeHost, makeReport, NOW, originExpiringIn } from '@/utils/ssl/testReport'
import { sitesAttention } from './attention'
import { commandPresets, commandProblem, pushHistory } from '@/utils/server/sites/commands'
import { joinSites, siteCertificate, siteFile, siteStack } from '@/utils/server/sites/join'
import { makeInventory } from '@/utils/server/sites/fixtures/inventory'
import { httpsView, matchesSiteFilter, matchesSiteSearch, siteFilterCounts, siteRowAction, siteRuntime } from './siteView'

const app = makeSummary({ config: { name: 'app', path: '/var/www/app', healthUrl: 'https://app.example.com/up', activateSteps: [{ command: 'php artisan migrate --force', optional: false, timeoutSeconds: null }] } })
const docs = makeSummary({ config: { name: 'docs', path: '/var/www/docs', buildSteps: [{ command: 'npm ci', optional: false, timeoutSeconds: null }] } })

const report = makeReport({
  blocks: [
    makeBlock({ id: 'app:1', line: 1, tls: false, root: null, names: ['app.example.com', 'www.app.example.com'] }),
    makeBlock({ id: 'app:9', line: 9, root: '/var/www/app/current/public', names: ['app.example.com', 'www.app.example.com'] }),
    makeBlock({ id: 'docs:1', file: '/etc/nginx/sites-enabled/docs', root: '/var/www/docs/current', names: ['docs.example.com'], tls: false }),
    makeBlock({ id: 'mail:1', file: '/etc/nginx/sites-enabled/mail', root: '/srv/mail', names: ['mail.example.com'] })
  ],
  hostnames: [
    makeHost({ name: 'app.example.com', blockId: 'app:9' }),
    makeHost({ name: 'www.app.example.com', blockId: 'app:9', verdict: 'will-break', origin: originExpiringIn(-2), reason: 'Expired' }),
    makeHost({ name: 'mail.example.com', blockId: 'mail:1', verdict: 'expiring', origin: originExpiringIn(5) })
  ]
})

describe('joinSites', () => {
  const join = joinSites([app, docs], report)

  it('matches web server sites by root folder and shared names', () => {
    expect(join.sites[0].blocks.map((b) => b.id)).toEqual(['app:1', 'app:9'])
    expect(join.sites[0].hosts.map((h) => h.name)).toEqual(['app.example.com', 'www.app.example.com'])
    expect(join.sites[0].domain).toBe('app.example.com')
    expect(siteFile(join.sites[0])).toBe('/etc/nginx/sites-enabled/app.conf')
  })

  it('finds the certbot certificate that covers the site', () => {
    const withLineage = { ...report, lineages: [{ name: 'app.example.com', domains: ['app.example.com', 'www.app.example.com'], notAfter: null, certPath: '', keyPath: '' }] }
    expect(siteCertificate(join.sites[0], withLineage)).toEqual({ lineage: 'app.example.com', names: ['app.example.com', 'www.app.example.com'] })
    expect(siteCertificate(join.sites[1], withLineage)).toBeNull()
  })

  it('keeps hostnames that belong to no deploy site apart', () => {
    expect(join.otherHosts.map((h) => h.name)).toEqual(['mail.example.com'])
  })

  it('works before the SSL check finishes', () => {
    expect(joinSites([app], null)).toEqual({ sites: [{ summary: app, blocks: [], hosts: [], domain: null }], otherHosts: [] })
  })

  it('reports HTTPS state and the next action per site', () => {
    const [appEntry, docsEntry] = join.sites
    expect(httpsView(appEntry, NOW).tone).toBe('error')
    expect(siteRowAction(appEntry, 'live')).toBe('fix-https')
    expect(siteRowAction(appEntry, 'failed')).toBe('review')
    expect(httpsView(docsEntry, NOW)).toEqual({ label: 'No HTTPS', sub: 'HTTP only', tone: 'warning' })
    expect(siteRowAction(docsEntry, 'live')).toBe('add-https')
  })

  it('reads PHP version and web server from the site file', () => {
    const inventory = makeInventory({ vhosts: [{ path: '/etc/nginx/sites-enabled/app.conf', realPath: '/etc/nginx/sites-available/app.conf', sha256: 'a'.repeat(64), content: 'fastcgi_pass unix:/run/php/php8.3-fpm.sock;' }] })
    expect(siteRuntime(join.sites[0], inventory)).toBe('PHP 8.3 · nginx')
    expect(siteRuntime(join.sites[0], null)).toBe('nginx')
  })

  it('filters by stack, attention and search', () => {
    expect(siteStack(app)).toBe('laravel')
    expect(siteStack(docs)).toBe('node')
    expect(matchesSiteFilter(join.sites[0], 'php')).toBe(true)
    expect(matchesSiteFilter(join.sites[1], 'attention')).toBe(false)
    expect(matchesSiteSearch(join.sites[0], 'www.app')).toBe(true)
    expect(siteFilterCounts(join.sites, {})).toEqual({ all: 2, attention: 1, php: 1, node: 1, static: 0, docker: 0 })
  })
})

describe('sitesAttention', () => {
  it('ranks broken certificates, then failed deploys, then expiring certificates', () => {
    const failed = makeSummary({ config: { ...app.config }, history: [makeRecord({ status: 'failed', note: 'npm ci failed' })] })
    const items = sitesAttention(joinSites([failed], report), NOW)
    expect(items.map((i) => [i.id, i.rank, i.level])).toEqual([
      ['sites.cert.www.app.example.com', 170, 'error'],
      ['sites.deploy.app', 160, 'error'],
      ['sites.cert.mail.example.com', 85, 'warning']
    ])
    expect(items[0].route).toEqual({ section: 'sites', sub: 'site', params: { site: 'app', tab: 'domains' } })
    expect(items[1].detail).toBe('npm ci failed')
    expect(items[2].route).toEqual({ section: 'sites', sub: 'hostname', params: { name: 'mail.example.com' } })
  })
})

describe('commands', () => {
  it('offers artisan presets only for Laravel', () => {
    expect(commandPresets('laravel').map((p) => p.command)).toContain('php artisan down')
    expect(commandPresets('docker')).toEqual([])
  })

  it('validates and remembers commands', () => {
    expect(commandProblem('  ')).toBe('Type a command')
    expect(commandProblem('a\tb')).toContain('single line')
    expect(pushHistory(['ls', 'pwd'], 'pwd')).toEqual(['pwd', 'ls'])
    expect(pushHistory(Array.from({ length: 10 }, (_, i) => `c${i}`), 'new')).toHaveLength(10)
  })
})
