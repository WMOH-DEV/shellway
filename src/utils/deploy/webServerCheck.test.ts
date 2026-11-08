import { describe, expect, it } from 'vitest'
import type { DirectoryRule, VhostDetail } from '../webServer/apache/sites'
import { isInside, type WebServerCheck, type WebServerSite } from '../webServer/siteFolder'
import { linkState, overrideState, webServerItems } from './webServerCheck'

const SITE_PATH = '/var/www/app'
const ROOT = '/var/www/app/public'

const rule = (path: string, options: string[] = [], allowOverride: string[] = []): DirectoryRule => ({ path, options, allowOverride })

function site(detail: Partial<VhostDetail> = {}): WebServerSite {
  return {
    file: '/etc/apache2/sites-enabled/app-le-ssl.conf',
    names: ['app.example.com'],
    detail: { documentRoot: ROOT, directories: [], phpHandler: null, rewriteEngine: false, includes: [], ...detail }
  }
}

function check(overrides: Partial<WebServerCheck> = {}): WebServerCheck {
  return { server: 'apache', layout: 'debian', read: 'full', sites: [site()], rewriteModule: true, ...overrides }
}

const byId = (items: ReturnType<typeof webServerItems>, id: string) => items.find((item) => item.id === id)

describe('isInside', () => {
  it('matches the folder itself and folders below it, not lookalike names', () => {
    expect(isInside('/var/www/app/public', '/var/www/app')).toBe(true)
    expect(isInside('/var/www/app/', '/var/www/app')).toBe(true)
    expect(isInside('/var/www/application', '/var/www/app')).toBe(false)
    expect(isInside('/var/www/app', '/')).toBe(true)
  })
})

describe('linkState', () => {
  it('lets the most specific Directory decide, with + and - adjusting the parent', () => {
    expect(linkState([rule('/var/www', ['Indexes', 'FollowSymLinks'])], ROOT)).toBe('follow')
    expect(linkState([rule('/var/www', ['FollowSymLinks']), rule(ROOT, ['-FollowSymLinks'])], ROOT)).toBe('off')
    expect(linkState([rule(ROOT, ['None']), rule('/var/www', ['All'])], ROOT)).toBe('off')
    expect(linkState([rule('/var/www', ['None']), rule(SITE_PATH, ['+FollowSymLinks'])], ROOT)).toBe('follow')
  })

  it('reports owner matching and leaves an untouched setting unset', () => {
    expect(linkState([rule(ROOT, ['SymLinksIfOwnerMatch'])], ROOT)).toBe('owner-match')
    expect(linkState([rule(ROOT, [], ['All'])], ROOT)).toBe('unset')
    expect(linkState([rule('/srv/other', ['None'])], ROOT)).toBe('unset')
  })
})

describe('overrideState', () => {
  it('uses the most specific AllowOverride that covers the folder', () => {
    expect(overrideState([rule('/var/www', [], ['None']), rule(ROOT, [], ['All'])], ROOT)).toBe('allowed')
    expect(overrideState([rule(ROOT, [], ['FileInfo=RewriteEngine,RewriteRule'])], ROOT)).toBe('allowed')
    expect(overrideState([rule('/var/www', [], ['All']), rule(ROOT, [], ['None'])], ROOT)).toBe('denied')
    expect(overrideState([], ROOT)).toBe('unset')
  })
})

describe('webServerItems', () => {
  it('adds nothing when Apache does not serve the site', () => {
    expect(webServerItems(SITE_PATH, 'releases', check({ server: 'nginx' }))).toEqual([])
    expect(webServerItems(SITE_PATH, 'releases', check({ server: null }))).toEqual([])
  })

  it('warns when no Apache site points into the site folder, and says when files were unreadable', () => {
    const items = webServerItems(SITE_PATH, 'releases', check({ sites: [], read: 'partial' }))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'web-site', status: 'fail', required: false, title: 'No Apache site serves /var/www/app' })
    expect(items[0].detail).toContain('/var/www/app/public')
    expect(items[0].detail).toContain('could not read every Apache file')
  })

  it('passes a site that follows links and allows .htaccess', () => {
    const items = webServerItems(SITE_PATH, 'releases', check({ sites: [site({ directories: [rule(ROOT, ['FollowSymLinks'], ['All'])] })] }))
    expect(items.map((item) => [item.id, item.status])).toEqual([['web-site', 'pass'], ['web-symlinks', 'pass'], ['web-rewrite', 'pass']])
    expect(items[0].title).toBe('Apache serves app.example.com from /var/www/app/public')
    expect(items.every((item) => !item.required)).toBe(true)
  })

  it('suggests FollowSymLinks for the site folder when links are off or owner-matched', () => {
    const off = byId(webServerItems(SITE_PATH, 'releases', check({ sites: [site({ directories: [rule(ROOT, ['-FollowSymLinks'])] })] })), 'web-symlinks')
    expect(off).toMatchObject({ status: 'fail', title: 'Apache will not follow the link to the current release', code: '<Directory /var/www/app>\n    Options FollowSymLinks\n</Directory>' })
    const owner = byId(webServerItems(SITE_PATH, 'releases', check({ sites: [site({ directories: [rule(ROOT, ['SymLinksIfOwnerMatch'])] })] })), 'web-symlinks')
    expect(owner?.status).toBe('fail')
  })

  it('skips the link check for in-place sites', () => {
    expect(byId(webServerItems(SITE_PATH, 'inplace', check()), 'web-symlinks')).toBeUndefined()
  })

  it('warns about .htaccess when AllowOverride is off or unset, and passes rewrite rules in the site file', () => {
    const denied = byId(webServerItems(SITE_PATH, 'releases', check({ sites: [site({ directories: [rule(ROOT, [], ['None'])] })] })), 'web-rewrite')
    expect(denied).toMatchObject({ status: 'fail', title: 'Apache ignores .htaccess in /var/www/app/public', code: '<Directory /var/www/app/public>\n    AllowOverride All\n</Directory>' })
    expect(byId(webServerItems(SITE_PATH, 'releases', check()), 'web-rewrite')?.title).toBe('AllowOverride is not set for /var/www/app/public')
    expect(byId(webServerItems(SITE_PATH, 'releases', check({ sites: [site({ rewriteEngine: true })] })), 'web-rewrite')?.status).toBe('pass')
  })

  it('warns first when mod_rewrite is off, with the Debian command only on Debian', () => {
    const debian = byId(webServerItems(SITE_PATH, 'releases', check({ rewriteModule: false })), 'web-rewrite')
    expect(debian).toMatchObject({ title: 'mod_rewrite is not enabled', code: 'sudo a2enmod rewrite && sudo systemctl reload apache2' })
    expect(byId(webServerItems(SITE_PATH, 'releases', check({ rewriteModule: false, layout: 'rhel' })), 'web-rewrite')?.code).toBeNull()
  })
})
