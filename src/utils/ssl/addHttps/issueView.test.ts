import { describe, expect, it } from 'vitest'
import type { IssueRequest } from '../../../types/ssl'
import { edgeOf, makeHost, makeOrigin } from '../testReport'
import { certbotChanges, commandRows, isMissingServerCertificate, issueFailureView, weakSslHosts, weakZones } from './issueView'
import { issueFailure } from './testFixtures'
import { nginxDriver } from '../../webServer/nginx'
import { apacheDriver } from '../../webServer/apache'

const request: IssueRequest = { blockId: 'app.conf:1', names: ['app.example.com', 'www.app.example.com'], email: 'admin@example.com', redirect: true, staging: true }

describe('commandRows', () => {
  it('lists the staging test before the real command', () => {
    const rows = commandRows(request, nginxDriver)
    expect(rows?.map((r) => r.tag)).toEqual(['test', 'issue'])
    expect(rows?.[0].command).toContain('--dry-run')
    expect(rows?.[1].command).toContain('--redirect')
  })

  it('leaves the staging test out when it is off', () => {
    expect(commandRows({ ...request, staging: false }, nginxDriver)?.map((r) => r.tag)).toEqual(['issue'])
  })

  it('returns nothing while the request is not valid', () => {
    expect(commandRows({ ...request, email: 'nope' }, nginxDriver)).toBeNull()
    expect(commandRows({ ...request, names: [] }, nginxDriver)).toBeNull()
  })
})

describe('certbotChanges', () => {
  it('names the certificate files under the first name in the nginx file', () => {
    const changes = certbotChanges(request, '/etc/nginx/sites-enabled/app.conf', nginxDriver)
    expect(changes).toMatchObject({ file: '/etc/nginx/sites-enabled/app.conf', newFile: false })
    expect(changes.lines).toEqual([
      'listen 443 ssl;',
      'ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;',
      'ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;',
      'include /etc/letsencrypt/options-ssl-nginx.conf;',
      'ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;'
    ])
  })

  it('shows the new -le-ssl.conf virtual host certbot writes for Apache', () => {
    const changes = certbotChanges(request, '/etc/apache2/sites-enabled/app.conf', apacheDriver('debian'))
    expect(changes).toMatchObject({ file: '/etc/apache2/sites-enabled/app-le-ssl.conf', newFile: true })
    expect(changes.lines).toContain('Include /etc/letsencrypt/options-ssl-apache.conf')
    expect(changes.redirectNote).toContain('/etc/apache2/sites-enabled/app.conf')
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
    expect(found).toEqual([{ name: 'app.example.com', mode: 'Flexible', zone: 'example.com' }, { name: 'www.app.example.com', mode: 'Off', zone: 'example.com' }])
    expect(weakSslHosts([flexible], ['other.example.com'])).toEqual([])
  })
})

describe('weakZones', () => {
  it('lists each zone once and skips hosts without a zone', () => {
    expect(weakZones([
      { name: 'app.example.com', mode: 'Flexible', zone: 'example.com' },
      { name: 'www.example.com', mode: 'Off', zone: 'example.com' },
      { name: 'app.example.org', mode: 'Flexible', zone: 'example.org' },
      { name: 'x.example.net', mode: 'Flexible', zone: null }
    ])).toEqual(['example.com', 'example.org'])
    expect(weakZones([])).toEqual([])
  })
})

describe('issueFailureView', () => {
  it('names Apache in the failure title and notes', () => {
    const view = issueFailureView(issueFailure({ failedStage: 'nginx-test', restored: true }), 'Apache')
    expect(view.title).toBe('Apache rejected the changed configuration')
    expect(view.notes[0]).toMatch(/^The Apache file was restored/)
  })

  it('says the real request was not sent when staging failed', () => {
    const view = issueFailureView(issueFailure({ failedStage: 'staging', hint: 'Port 80 is blocked' }), 'nginx')
    expect(view.title).toBe('The staging test failed')
    expect(view.notes).toEqual(['The nginx file was not changed.', "The real certificate was not requested, so no Let's Encrypt limit was used."])
    expect(view.hint).toBe('Port 80 is blocked')
  })

  it('says the file was restored when nginx rejected the change', () => {
    const view = issueFailureView(issueFailure({ failedStage: 'nginx-test', restored: true }), 'nginx')
    expect(view.notes).toEqual(['The nginx file was restored from its backup (/etc/ssl/shellway/backups/app.conf.1800000000).'])
  })

  it('points to the backup when the restore did not happen', () => {
    const view = issueFailureView(issueFailure({ failedStage: 'restore', restored: false }), 'nginx')
    expect(view.notes[0]).toBe('The nginx file was not restored automatically. Your backup is at /etc/ssl/shellway/backups/app.conf.1800000000.')
  })
})
