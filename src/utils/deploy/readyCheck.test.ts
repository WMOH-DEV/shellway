import { describe, it, expect } from 'vitest'
import type { DoctorReport, SiteConfig } from '@/types/deploy'
import { readyItems, readySummary, requiredLeftLabel, type KeyAccess, type ReadyInput } from './readyCheck'
import { newSite } from './presets'

const report = (overrides: Partial<DoctorReport> = {}): DoctorReport => ({
  user: 'deploy', git: true, curl: true, wget: false, crontab: true, sshKeygen: true,
  sitePathKind: 'dir', parentWritable: true, siteWritable: true, deployKey: true, sudoOk: [], sudoNeeds: [], ...overrides
})

const site = (overrides: Partial<SiteConfig> = {}): SiteConfig => ({
  ...newSite('/var/www/example-app'), repoUrl: 'git@github.com:acme/example-app.git', ...overrides
})

const input = (overrides: Partial<ReadyInput> = {}): ReadyInput => ({
  site: site(), report: report(), access: { state: 'ok', head: 'abcdef0123' }, publicKey: 'ssh-ed25519 AAAA example', ...overrides
})

const find = (items: ReturnType<typeof readyItems>, id: string) => items.find((item) => item.id === id)

describe('readyItems tools', () => {
  it('passes when git, cron and ssh-keygen exist for an auto site', () => {
    expect(find(readyItems(input()), 'tools')).toMatchObject({ status: 'pass', detail: 'git · cron · ssh-keygen' })
  })

  it('lists every missing tool in one failing item', () => {
    const item = find(readyItems(input({ report: report({ git: false, crontab: false }) })), 'tools')
    expect(item).toMatchObject({ status: 'fail', required: true, title: 'Missing on the server: git, cron' })
  })

  it('only asks for curl or wget when there is a health check', () => {
    const noCurl = report({ curl: false, wget: false })
    expect(find(readyItems(input({ report: noCurl })), 'tools')?.status).toBe('pass')
    const withHealth = input({ report: noCurl, site: site({ healthUrl: 'https://example.com/up' }) })
    expect(find(readyItems(withHealth), 'tools')?.title).toContain('curl or wget')
  })

  it('does not need cron or ssh-keygen for a site deployed from the PC', () => {
    const pc = input({ site: site({ sourceMode: 'pc' }), report: report({ crontab: false, sshKeygen: false }) })
    expect(find(readyItems(pc), 'tools')).toMatchObject({ status: 'pass', detail: 'git' })
  })
})

describe('readyItems key', () => {
  it('is left out for a site deployed from the PC', () => {
    expect(find(readyItems(input({ site: site({ sourceMode: 'pc' }) })), 'key')).toBeUndefined()
  })

  it('passes once access was confirmed and names the commit it can read', () => {
    expect(find(readyItems(input()), 'key')).toMatchObject({ status: 'pass', title: 'Server can read acme/example-app', detail: 'Reads main (abcdef0)' })
  })

  it('offers the key, GitHub and test actions while access is not confirmed', () => {
    const item = find(readyItems(input({ access: { state: 'idle' } })), 'key')
    expect(item).toMatchObject({ status: 'fail', required: true, code: 'ssh-ed25519 AAAA example' })
    expect(item?.actions).toEqual(['copy', 'add-to-github', 'test-access', 'add-by-hand'])
  })

  it('leaves out the GitHub actions for other git hosts', () => {
    const other = input({ access: { state: 'idle' }, site: site({ repoUrl: 'git@git.example.com:acme/example-app.git' }) })
    const item = find(readyItems(other), 'key')
    expect(item?.title).toBe('Server can read the repository')
    expect(item?.actions).toEqual(['copy', 'test-access'])
  })

  it('shows the failure message and the checking state', () => {
    const failed: KeyAccess = { state: 'failed', message: 'Permission denied' }
    expect(find(readyItems(input({ access: failed })), 'key')?.detail).toContain('Permission denied')
    expect(find(readyItems(input({ access: { state: 'checking' } })), 'key')?.status).toBe('checking')
  })

  it('falls back to whether the server has a key when access was never tested', () => {
    expect(find(readyItems(input({ access: null })), 'key')?.status).toBe('pass')
    expect(find(readyItems(input({ access: null, report: report({ deployKey: false }) })), 'key')?.status).toBe('fail')
  })

  it('points to the Deploy key screen when only the presence of a key is known', () => {
    const item = find(readyItems(input({ access: null, report: report({ deployKey: false }) })), 'key')
    expect(item?.detail).toContain('Open Deploy key')
  })

  it('has no code until the public key is known', () => {
    expect(find(readyItems(input({ access: { state: 'idle' }, publicKey: '' })), 'key')?.code).toBeNull()
  })
})

describe('readyItems folder', () => {
  it('asks to make the parent writable for a new releases site', () => {
    const item = find(readyItems(input({ report: report({ parentWritable: false, sitePathKind: 'missing' }) })), 'folder')
    expect(item).toMatchObject({ status: 'fail', required: true, code: 'sudo setfacl -m u:deploy:rwx /var/www', actions: ['copy'] })
  })

  it('does not need the parent once the site is already a symlink', () => {
    expect(find(readyItems(input({ report: report({ parentWritable: false, sitePathKind: 'symlink' }) })), 'folder')?.status).toBe('pass')
  })

  it('fails on a symlink Shellway did not create', () => {
    const item = find(readyItems(input({ report: report({ sitePathKind: 'foreign-symlink' }) })), 'folder')
    expect(item).toMatchObject({ status: 'fail', code: null })
  })

  it('uses the parent of a path with a trailing slash and of a top level folder', () => {
    const trailing = input({ site: site({ path: '/srv/www/app/' }), report: report({ parentWritable: false }) })
    expect(find(readyItems(trailing), 'folder')?.code).toBe('sudo setfacl -m u:deploy:rwx /srv/www')
    const top = input({ site: site({ path: '/app' }), report: report({ parentWritable: false }) })
    expect(find(readyItems(top), 'folder')?.code).toBe('sudo setfacl -m u:deploy:rwx /')
  })

  it('checks the site folder itself for an in place site', () => {
    const inPlace = site({ layout: 'inplace' })
    const blocked = input({ site: inPlace, report: report({ siteWritable: false }) })
    expect(find(readyItems(blocked), 'folder')).toMatchObject({ status: 'fail', code: 'sudo chown -R deploy /var/www/example-app' })
    const missing = input({ site: inPlace, report: report({ siteWritable: false, sitePathKind: 'missing' }) })
    expect(find(readyItems(missing), 'folder')?.status).toBe('pass')
  })
})

describe('readyItems sudo', () => {
  it('is left out when no command uses sudo', () => {
    expect(find(readyItems(input()), 'sudo')).toBeUndefined()
  })

  it('builds the sudoers line for commands that would ask for a password, without making them required', () => {
    const item = find(readyItems(input({ report: report({ sudoNeeds: ['/usr/bin/systemctl reload php8.3-fpm'] }) })), 'sudo')
    expect(item).toMatchObject({
      status: 'fail',
      required: false,
      title: 'Passwordless sudo for 1 command',
      code: 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl reload php8.3-fpm'
    })
    expect(item?.detail).toContain('sudo /usr/bin/systemctl reload php8.3-fpm')
  })

  it('passes when every sudo command is already allowed', () => {
    const item = find(readyItems(input({ report: report({ sudoOk: ['/usr/bin/a', '/usr/bin/b'] }) })), 'sudo')
    expect(item).toMatchObject({ status: 'pass', title: 'Passwordless sudo for 2 commands' })
  })
})

describe('readySummary', () => {
  it('counts passed items and only required failures block the first deploy', () => {
    const items = readyItems(input({ report: report({ sudoNeeds: ['/usr/bin/x'] }) }))
    expect(readySummary(items)).toEqual({ passed: 3, total: 4, requiredLeft: 0, ready: true })
  })

  it('counts a checking required item as not ready yet', () => {
    const summary = readySummary(readyItems(input({ access: { state: 'checking' } })))
    expect(summary).toMatchObject({ requiredLeft: 1, ready: false })
  })

  it('labels how many required items are left', () => {
    expect([0, 1, 2].map(requiredLeftLabel)).toEqual(['All required items are ready', '1 required item left', '2 required items left'])
  })
})
