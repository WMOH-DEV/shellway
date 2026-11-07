import { describe, expect, it } from 'vitest'
import type { ServerFacts } from '../../types/ssl'
import { lastAlertText, renewalOutputOf, serverCheckRows } from './settingsServer'

const NOW = 1_800_000_000

const facts = (overrides: Partial<ServerFacts> = {}): ServerFacts => ({
  nginx: '1.24.0',
  openssl: '3.0.13',
  certbot: '2.11.0',
  otherWebServer: null,
  apache: null,
  serving: 'nginx',
  nginxParse: 'full',
  renewal: { mechanism: 'certbot.timer', lastRun: NOW - 7200, lastResult: 'success', output: '' },
  sudo: { certbot: true, nginx: true, apache: false, full: true },
  paths: { certbot: '/usr/bin/certbot', nginx: '/usr/sbin/nginx', apache: null },
  user: 'deploy',
  addresses: ['203.0.113.10'],
  ...overrides
})

const row = (f: ServerFacts, id: string) => serverCheckRows(f, NOW).find((r) => r.id === id)!

describe('serverCheckRows', () => {
  it('is all good on a healthy server', () => {
    expect(serverCheckRows(facts(), NOW).map((r) => r.tone)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'])
  })

  it('names Caddy when neither nginx nor Apache is there', () => {
    const r = row(facts({ nginx: null, otherWebServer: 'caddy' }), 'web-server')
    expect(r.tone).toBe('warn')
    expect(r.detail).toContain('Caddy')
  })

  it('checks Apache and its sudo when Apache answers on the web ports', () => {
    const f = facts({ apache: { version: '2.4.62', layout: 'debian' }, serving: 'apache', paths: { certbot: '/usr/bin/certbot', nginx: null, apache: '/usr/sbin/apache2ctl' } })
    expect(row(f, 'web-server')).toMatchObject({ name: 'Apache', tone: 'ok', detail: '2.4.62' })
    expect(row(f, 'sudo-apache')).toMatchObject({ name: 'sudo -n apache2ctl', tone: 'bad' })
    expect(row(f, 'sudo-apache').sudoers).toContain('/usr/sbin/apache2ctl')
  })

  it('treats a missing certbot as a warning and openssl as a failure', () => {
    expect(row(facts({ certbot: null }), 'certbot').tone).toBe('warn')
    expect(row(facts({ openssl: null }), 'openssl').tone).toBe('bad')
  })

  it('reports a failed renewal with how long ago', () => {
    const r = row(facts({ renewal: { mechanism: 'cron', lastRun: NOW - 86400 * 3, lastResult: 'failed', output: 'x' } }), 'renewal')
    expect(r).toMatchObject({ tone: 'bad', detail: 'cron · failed 3 d ago' })
  })

  it('reports an unknown last result as a warning', () => {
    const r = row(facts({ renewal: { mechanism: 'certbot.timer', lastRun: null, lastResult: 'unknown', output: '' } }), 'renewal')
    expect(r).toMatchObject({ tone: 'warn', detail: 'certbot.timer · last result unknown' })
  })

  it('fails renewal only when certbot exists but nothing renews it', () => {
    const none = { mechanism: 'none' as const, lastRun: null, lastResult: 'unknown' as const, output: '' }
    expect(row(facts({ renewal: none }), 'renewal').tone).toBe('bad')
    expect(row(facts({ renewal: none, certbot: null }), 'renewal').tone).toBe('muted')
  })

  it('gives the exact sudoers line for a failing sudo row', () => {
    const f = facts({ sudo: { certbot: false, nginx: true, apache: false, full: false } })
    expect(row(f, 'sudo-certbot')).toMatchObject({ tone: 'bad', sudoers: 'deploy ALL=(root) NOPASSWD: /usr/bin/certbot' })
    expect(row(f, 'sudo-nginx').sudoers).toBeNull()
  })

  it('gives no sudoers line when the tool path is unknown', () => {
    const f = facts({ sudo: { certbot: false, nginx: false, apache: false, full: false }, paths: { certbot: null, nginx: null, apache: null } })
    expect(row(f, 'sudo-nginx')).toMatchObject({ tone: 'muted', sudoers: null })
  })

  it('explains what full sudo unlocks in both states', () => {
    expect(row(facts(), 'sudo-full').detail).toContain('Origin CA')
    expect(row(facts({ sudo: { certbot: true, nginx: true, apache: false, full: false } }), 'sudo-full')).toMatchObject({ tone: 'warn' })
  })
})

describe('renewalOutputOf', () => {
  it('is null when there is no output', () => {
    expect(renewalOutputOf(facts())).toBeNull()
  })

  it('returns trimmed output', () => {
    const f = facts({ renewal: { mechanism: 'cron', lastRun: null, lastResult: 'failed', output: '\nboom\n' } })
    expect(renewalOutputOf(f)).toBe('boom')
  })
})

describe('lastAlertText', () => {
  it('is null before any alert', () => {
    expect(lastAlertText(null, NOW)).toBeNull()
  })

  it('names the host, the problem and when', () => {
    const text = lastAlertText({ host: 'api.example.com', verdict: 'will-break', at: NOW - 600 }, NOW)
    expect(text).toBe('api.example.com · will break soon · 10 min ago')
  })
})
