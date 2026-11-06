import { describe, expect, it } from 'vitest'
import type { PrepFacts } from '../../../types/ssl'
import { availableRoutes, installPlan, installScript, isCertbotReady } from './installPlan'

const facts = (overrides: Partial<PrepFacts> = {}): PrepFacts => ({
  os: { id: 'ubuntu', versionId: '24.04', family: 'debian', pretty: 'Ubuntu 24.04 LTS' },
  arch: 'x86_64',
  webServer: 'nginx',
  certbot: null,
  plugins: [],
  snapd: '2.63',
  packageManager: 'apt',
  renewalTimer: null,
  fullSudo: true,
  ...overrides
})

const commands = (f: PrepFacts, route?: 'snap' | 'distro') =>
  installPlan(f, route).steps.map((s) => `${s.status} ${s.command}`)

describe('installPlan', () => {
  it('follows certbot.eff.org with the snap when snapd is there', () => {
    expect(commands(facts())).toEqual([
      'run snap install --classic certbot',
      'run ln -sf /snap/bin/certbot /usr/local/bin/certbot',
      'skip apt-get remove -y certbot',
      'check certbot --version',
      'check certbot plugins --text | grep -w nginx',
      'check systemctl is-active snap.certbot.renew.timer'
    ])
    expect(installPlan(facts())).toMatchObject({ route: 'snap', routes: ['snap', 'distro'], needed: true, blockedReason: null, docsUrl: 'https://certbot.eff.org/instructions?ws=nginx&os=snap' })
  })

  it('removes an old packaged certbot only after the snap is in place', () => {
    const old = facts({ certbot: { path: '/usr/bin/certbot', version: '1.21.0', method: 'apt' }, plugins: ['nginx'] })
    expect(commands(old).slice(0, 3)).toEqual(['run snap install --classic certbot', 'run ln -sf /snap/bin/certbot /usr/local/bin/certbot', 'run apt-get remove -y certbot'])
    expect(commands(facts({ certbot: { path: '/usr/bin/certbot', version: '2.6.0', method: 'dnf' }, os: { id: 'fedora', versionId: '40', family: 'rhel', pretty: 'Fedora 40' }, packageManager: 'dnf' }))[2]).toBe('run dnf remove -y certbot')
  })

  it('uses the apache plugin for Apache servers', () => {
    expect(commands(facts({ webServer: 'apache' }))).toContain('check certbot plugins --text | grep -w apache')
  })

  it('offers distribution packages on Debian and Ubuntu', () => {
    expect(commands(facts(), 'distro')).toEqual([
      'run apt-get update',
      'run DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx',
      'check certbot --version',
      'check certbot plugins --text | grep -w nginx',
      'check systemctl is-active certbot.timer'
    ])
  })

  it('adds EPEL and turns on the timer on Rocky and Alma, not on Fedora', () => {
    const rocky = facts({ os: { id: 'rocky', versionId: '9.4', family: 'rhel', pretty: 'Rocky Linux 9.4' }, packageManager: 'dnf', snapd: null })
    expect(commands(rocky)).toEqual([
      'run dnf install -y epel-release',
      'run dnf install -y certbot python3-certbot-nginx',
      'run systemctl enable --now certbot-renew.timer',
      'check certbot --version',
      'check certbot plugins --text | grep -w nginx',
      'check systemctl is-active certbot-renew.timer'
    ])
    const fedora = facts({ os: { id: 'fedora', versionId: '40', family: 'rhel', pretty: 'Fedora 40' }, packageManager: 'dnf', snapd: null })
    expect(commands(fedora)[0]).toBe('run dnf install -y certbot python3-certbot-nginx')
  })

  it('falls back to the available route', () => {
    expect(installPlan(facts({ snapd: null })).route).toBe('distro')
    expect(availableRoutes(facts({ arch: 's390x' }))).toEqual(['distro'])
  })

  it('never guesses commands for an unknown system, RHEL itself, or Caddy', () => {
    const unknown = installPlan(facts({ os: { id: 'alpine', versionId: '3.20', family: 'other', pretty: 'Alpine Linux v3.20' }, packageManager: null, snapd: null }))
    expect(unknown).toMatchObject({ steps: [], routes: [] })
    expect(unknown.blockedReason).toMatch(/no install commands for Alpine Linux v3.20/)
    expect(availableRoutes(facts({ os: { id: 'rhel', versionId: '9', family: 'rhel', pretty: 'Red Hat Enterprise Linux 9' }, packageManager: 'dnf', snapd: null }))).toEqual([])
    expect(installPlan(facts({ webServer: 'caddy' })).blockedReason).toMatch(/Caddy gets and renews/)
    expect(installPlan(facts({ webServer: null })).blockedReason).toMatch(/Neither nginx nor Apache/)
  })

  it('knows when nothing needs installing', () => {
    const ready = facts({ certbot: { path: '/usr/local/bin/certbot', version: '2.11.0', method: 'snap' }, plugins: ['nginx', 'standalone'], renewalTimer: 'snap.certbot.renew.timer' })
    expect(isCertbotReady(ready)).toBe(true)
    expect(installPlan(ready).needed).toBe(false)
    expect(commands(ready)[0]).toBe('skip snap install --classic certbot')
  })

  it('turns the plan into one script that stops at the first failure and skips skipped steps', () => {
    expect(installScript(installPlan(facts()))).toBe(
      'set -e\nsnap install --classic certbot\nln -sf /snap/bin/certbot /usr/local/bin/certbot\ncertbot --version\ncertbot plugins --text | grep -w nginx\nsystemctl is-active snap.certbot.renew.timer\n'
    )
  })
})
