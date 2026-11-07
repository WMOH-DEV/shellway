import { describe, expect, it } from 'vitest'
import { catalogRows } from './catalogView'
import { PACKAGES_NVM, PACKAGES_UBUNTU, PHP_OUTPUT, USAGE } from './fixtures/outputs'
import { parsePackages } from './packages'
import { parsePhp } from './php'
import { changedValues, extensionView } from './phpView'
import { parseUsage } from './usage'

const php = parsePhp(PHP_OUTPUT)

describe('catalogRows', () => {
  const rows = Object.fromEntries(catalogRows({ packages: parsePackages(PACKAGES_UBUNTU), php, usage: parseUsage(USAGE) }).map((row) => [row.entry.id, row]))

  it('shows installed services with state, usage and updates', () => {
    expect(rows.nginx).toMatchObject({ installed: true, version: '1.24.0', detail: 'running · 2 sites', tone: 'success', update: 'update available', updatePackages: ['nginx'] })
    expect(rows.mysql).toMatchObject({ version: '8.0.40', detail: 'running · 1 database', update: null })
    expect(rows.redis).toMatchObject({ version: '7.0.15', detail: 'failed', tone: 'error' })
  })

  it('marks missing components as not installed', () => {
    expect(rows.apache).toMatchObject({ installed: false, detail: 'not installed', tone: 'neutral' })
    expect(rows.postgresql.installed).toBe(false)
  })

  it('summarizes PHP, node, certbot and base tools', () => {
    expect(rows.php).toMatchObject({ version: '8.3', detail: '2 versions · 2 sites' })
    expect(rows.node).toMatchObject({ version: '20.18.0', detail: 'via NodeSource' })
    expect(rows.pm2.version).toBe('5.4.2')
    expect(rows.certbot).toMatchObject({ version: '2.11.0', detail: 'snap' })
    expect(rows.base).toMatchObject({ detail: 'missing unzip, htop', tone: 'warning' })
  })

  it('shows nvm installs', () => {
    const row = catalogRows({ packages: parsePackages(PACKAGES_NVM), php: null, usage: null }).find((item) => item.entry.id === 'node')
    expect(row).toMatchObject({ installed: true, version: '20.18.0', detail: 'via nvm' })
  })
})

describe('extensionView', () => {
  it('splits installed, missing-but-used and available extensions', () => {
    const view = extensionView(php.versions[0], php.sites)
    expect(view.installed).toEqual(['bcmath', 'curl', 'mbstring', 'mysql', 'xml'])
    expect(view.available).toEqual(['imagick', 'pgsql'])
    expect(view.missing).toEqual([{ extension: 'imagick', packageSuffix: 'imagick', sites: ['app.example.com'] }])
  })
})

describe('changedValues', () => {
  it('keeps only edited non-empty values', () => {
    expect(changedValues({ a: '1', b: '2' }, { a: '1', b: '3', c: '' })).toEqual({ b: '3' })
  })
})
