import { describe, expect, it } from 'vitest'
import type { IssueRequest } from '../../../types/ssl'
import { edgeOf, makeHost, makeOrigin } from '../testReport'
import { commandRows, isMissingServerCertificate, issueFailureView, nginxChangeLines, weakSslHosts } from './issueView'
import { issueFailure } from './testFixtures'

const request: IssueRequest = { blockId: 'app.conf:1', names: ['app.example.com', 'www.app.example.com'], email: 'admin@example.com', redirect: true, staging: true }

describe('commandRows', () => {
  it('lists the staging test before the real command', () => {
    const rows = commandRows(request)
    expect(rows?.map((r) => r.tag)).toEqual(['test', 'issue'])
    expect(rows?.[0].command).toContain('--dry-run')
    expect(rows?.[1].command).toContain('--redirect')
  })

  it('leaves the staging test out when it is off', () => {
    expect(commandRows({ ...request, staging: false })?.map((r) => r.tag)).toEqual(['issue'])
  })

  it('returns nothing while the request is not valid', () => {
    expect(commandRows({ ...request, email: 'nope' })).toBeNull()
    expect(commandRows({ ...request, names: [] })).toBeNull()
  })
})

describe('nginxChangeLines', () => {
  it('names the certificate files under the first name', () => {
    expect(nginxChangeLines(request)).toEqual([
      'listen 443 ssl;',
      'ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;',
      'ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;',
      'include /etc/letsencrypt/options-ssl-nginx.conf;',
      'ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;'
    ])
  })
})

describe('isMissingServerCertificate', () => {
  it('is true for no certificate or not encrypted to the server', () => {
    expect(isMissingServerCertificate(makeHost({ origin: makeOrigin({ kind: 'none' }) }))).toBe(true)
    expect(isMissingServerCertificate(makeHost({ verdict: 'not-encrypted' }))).toBe(true)
    expect(isMissingServerCertificate(makeHost({ origin: null, verdict: 'unchecked' }))).toBe(false)
    expect(isMissingServerCertificate(makeHost())).toBe(false)
  })
})

describe('weakSslHosts', () => {
  it('finds picked names that are proxied with Flexible or Off', () => {
    const flexible = makeHost({ name: 'app.example.com', edge: edgeOf({ sslMode: 'flexible' }) })
    const off = makeHost({ name: 'www.app.example.com', edge: edgeOf({ sslMode: 'off' }) })
    const strict = makeHost({ name: 'api.example.com', edge: edgeOf({ sslMode: 'strict' }) })
    const dnsOnly = makeHost({ name: 'old.example.com', edge: edgeOf({ state: 'dns-only', sslMode: 'flexible' }) })
    const found = weakSslHosts([flexible, off, strict, dnsOnly], ['app.example.com', 'www.app.example.com', 'api.example.com', 'old.example.com'])
    expect(found).toEqual([{ name: 'app.example.com', mode: 'Flexible' }, { name: 'www.app.example.com', mode: 'Off' }])
    expect(weakSslHosts([flexible], ['other.example.com'])).toEqual([])
  })
})

describe('issueFailureView', () => {
  it('says the real request was not sent when staging failed', () => {
    const view = issueFailureView(issueFailure({ failedStage: 'staging', hint: 'Port 80 is blocked' }))
    expect(view.title).toBe('The staging test failed')
    expect(view.notes).toEqual(['The nginx file was not changed.', "The real certificate was not requested, so no Let's Encrypt limit was used."])
    expect(view.hint).toBe('Port 80 is blocked')
  })

  it('says the file was restored when nginx rejected the change', () => {
    const view = issueFailureView(issueFailure({ failedStage: 'nginx-test', restored: true }))
    expect(view.notes).toEqual(['The nginx file was restored from its backup (/etc/ssl/shellway/backups/app.conf.1800000000).'])
  })

  it('points to the backup when the restore did not happen', () => {
    const view = issueFailureView(issueFailure({ failedStage: 'restore', restored: false }))
    expect(view.notes[0]).toBe('The nginx file was not restored automatically. Your backup is at /etc/ssl/shellway/backups/app.conf.1800000000.')
  })
})
