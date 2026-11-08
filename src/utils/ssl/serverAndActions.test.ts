import { describe, expect, it } from 'vitest'
import { actionAvailability, actionOutcome, shouldEmphasizeTest } from './certbotActions'
import { cloudflareButton, hostnamesSubtitle, webServerNotice } from './header'
import { serverStrip } from './serverStrip'
import { formatDay } from './time'
import { connectedCloudflare, DAY, makeFacts, makeHost, makeReport, NOW } from './testReport'

const textOf = (item: ReturnType<typeof serverStrip>[number]): string => item.parts.map((p) => p.text).join(' ')

describe('serverStrip', () => {
  it('lists certbot, renewal, sudo and full sudo with tones', () => {
    const items = serverStrip(makeFacts({ renewal: { mechanism: 'certbot.timer', lastRun: NOW - 5 * DAY, lastResult: 'failed', output: '' } }), NOW)
    expect(items.map((i) => [i.key, textOf(i), i.tone])).toEqual([
      ['certbot', 'certbot 2.11.0', 'neutral'],
      ['renewal', `certbot.timer last run failed ${formatDay(NOW - 5 * DAY)}`, 'error'],
      ['sudo', 'sudo for certbot, nginx', 'success'],
      ['full-sudo', 'no full sudo (Origin CA switch unavailable)', 'neutral']
    ])
  })

  it('drops the renewal item and notes it when certbot is missing', () => {
    const items = serverStrip(makeFacts({ certbot: null }), NOW)
    expect(items.map((i) => i.key)).toEqual(['certbot', 'sudo', 'full-sudo'])
    expect(textOf(items[0])).toBe('certbot not installed')
  })

  it('says when sudo is not installed', () => {
    const items = serverStrip(makeFacts({ sudo: { certbot: false, nginx: false, apache: false, full: false, installed: false } }), NOW)
    expect(textOf(items.find((i) => i.key === 'sudo')!)).toBe('sudo is not installed')
    expect(items.find((i) => i.key === 'sudo')).toMatchObject({ tone: 'error' })
    expect(items.find((i) => i.key === 'full-sudo')).toBeUndefined()
  })

  it('warns about partial sudo and a missing timer', () => {
    const items = serverStrip(makeFacts({ sudo: { certbot: true, nginx: false, apache: false, full: true, installed: true }, renewal: { mechanism: 'none', lastRun: null, lastResult: 'unknown', output: '' } }), NOW)
    expect(items.find((i) => i.key === 'sudo')).toMatchObject({ tone: 'warning' })
    expect(items.find((i) => i.key === 'renewal')).toMatchObject({ tone: 'warning' })
    expect(textOf(items.find((i) => i.key === 'full-sudo')!)).toBe('full sudo (Origin CA switch available)')
  })
})

describe('header text', () => {
  it('counts hostnames and says when the report was made', () => {
    expect(hostnamesSubtitle(makeReport(), 'Test server', NOW)).toBe('1 hostname served by nginx on Test server · checked 2 min ago')
  })

  it('says no web server was found instead of counting hostnames', () => {
    const report = makeReport({ facts: makeFacts({ nginx: null }), hostnames: [] })
    expect(hostnamesSubtitle(report, 'Test server', NOW)).toBe('nginx or Apache not found on Test server · checked 2 min ago')
  })

  it('names Apache when Apache answers on the web ports', () => {
    const facts = makeFacts({ apache: { version: '2.4.62', layout: 'debian' }, serving: 'apache' })
    expect(hostnamesSubtitle(makeReport({ facts }), 'Test server', NOW)).toBe('1 hostname served by Apache on Test server · checked 2 min ago')
    expect(webServerNotice({ ...facts, nginxParse: 'unavailable' })?.text).toContain('passwordless sudo for Apache')
  })

  it('keeps nginx when both are installed but nginx answers', () => {
    const facts = makeFacts({ apache: { version: '2.4.62', layout: 'debian' }, serving: 'nginx' })
    expect(hostnamesSubtitle(makeReport({ facts }), 'Test server', NOW)).toContain('served by nginx')
  })

  it('summarises the Cloudflare connection', () => {
    expect(cloudflareButton(connectedCloudflare)).toEqual({ label: 'Cloudflare connected · 2 zones', tone: 'success' })
    expect(cloudflareButton({ ...connectedCloudflare, saved: false })).toEqual({ label: 'Add Cloudflare token', tone: 'neutral' })
    expect(cloudflareButton({ ...connectedCloudflare, permissions: [{ id: 'monitoring', state: 'missing', lines: [] }] })).toEqual({ label: 'Cloudflare: missing permissions', tone: 'warning' })
    expect(cloudflareButton({ ...connectedCloudflare, error: 'Invalid token' }).tone).toBe('error')
  })

  it('notes a partial parse, a missing web server and Caddy', () => {
    expect(webServerNotice(makeFacts())).toBeNull()
    expect(webServerNotice(makeFacts({ nginxParse: 'partial' }))?.kind).toBe('partial')
    expect(webServerNotice(makeFacts({ nginxParse: 'unavailable' }))?.kind).toBe('unavailable')
    const missing = webServerNotice(makeFacts({ nginx: null, otherWebServer: 'caddy' }))
    expect(missing?.kind).toBe('missing')
    expect(missing?.text).toContain('Caddy is installed here')
  })
})

describe('actionAvailability', () => {
  it('allows certbot actions with a lineage and sudo', () => {
    expect(actionAvailability(makeHost(), makeFacts())).toEqual({ allowed: true, reason: null })
  })

  it('explains each reason it cannot run', () => {
    expect(actionAvailability(makeHost(), makeFacts({ certbot: null })).reason).toMatch(/not installed/)
    expect(actionAvailability(makeHost({ lineage: null }), makeFacts()).reason).toMatch(/nothing to renew/)
    expect(actionAvailability(makeHost({ lineage: 'a b; rm' }), makeFacts()).reason).toMatch(/characters/)
    expect(actionAvailability(makeHost(), makeFacts({ sudo: { certbot: false, nginx: true, apache: false, full: false, installed: true } })).reason).toMatch(/sudo for certbot is missing/)
  })

  it('makes Test renewal primary only when renewal looks unhealthy', () => {
    expect(shouldEmphasizeTest(makeHost(), makeFacts())).toBe(false)
    expect(shouldEmphasizeTest(makeHost({ verdict: 'will-break' }), makeFacts())).toBe(true)
    expect(shouldEmphasizeTest(makeHost(), makeFacts({ renewal: { mechanism: 'certbot.timer', lastRun: NOW, lastResult: 'failed', output: '' } }))).toBe(true)
  })
})

describe('actionOutcome', () => {
  it('reports success, a non-zero exit and a call that could not run', () => {
    expect(actionOutcome('test', { code: 0, output: '' })).toEqual({ action: 'test', success: true, message: 'Test renewal succeeded' })
    expect(actionOutcome('renew', { code: 1, output: '' })).toEqual({ action: 'renew', success: false, message: 'Renewal failed (exit 1)' })
    expect(actionOutcome('force', null, 'No sudo')).toEqual({ action: 'force', success: false, message: 'Forced renewal could not run: No sudo' })
  })
})
