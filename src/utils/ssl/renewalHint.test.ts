import { describe, expect, it } from 'vitest'
import { renewalHint, type HintContext } from './renewalHint'

describe('renewalHint', () => {
  it('recognises a blocked HTTP-01 challenge and keeps the status code', () => {
    const output = 'Domain: api.example.com\nType: unauthorized\nDetail: 203.0.113.10: Invalid response from http://api.example.com/.well-known/acme-challenge/abc: 403'
    expect(renewalHint(output)).toContain('(403)')
    expect(renewalHint(output)).toContain('/.well-known/')
  })

  it('handles a 404 on the challenge path', () => {
    expect(renewalHint('GET /.well-known/acme-challenge/token returned 404')).toContain('(404)')
  })

  it('does not mistake an unrelated 403 for a challenge failure', () => {
    expect(renewalHint('Error 403 while talking to the proxy')).toBeNull()
  })

  it('recognises DNS problems', () => {
    expect(renewalHint('DNS problem: NXDOMAIN looking up A for old.example.com')).toBe('The name does not point to this server. Check its DNS record, then run Test renewal.')
  })

  it('recognises rate limits', () => {
    expect(renewalHint('too many certificates (5) already issued for this exact set of identifiers')).toMatch(/rate limit/)
    expect(renewalHint('An unexpected error occurred: rateLimited')).toMatch(/rate limit/)
  })

  it('recognises a blocked port 80', () => {
    expect(renewalHint('Timeout during connect (likely firewall problem)')).toMatch(/port 80/)
  })

  it('returns null for output it does not know', () => {
    expect(renewalHint('Congratulations, all renewals succeeded.')).toBeNull()
    expect(renewalHint('')).toBeNull()
  })

  const CONTEXTS: { name: string; context: HintContext; step: string; server: string; block: string }[] = [
    { name: 'renewal nginx', context: { action: 'renewal', webServer: 'nginx' }, step: 'run Test renewal', server: 'nginx', block: 'an nginx deny' },
    { name: 'renewal apache', context: { action: 'renewal', webServer: 'apache' }, step: 'run Test renewal', server: 'Apache', block: 'an Apache .htaccess/deny rule' },
    { name: 'issue nginx', context: { action: 'issue', webServer: 'nginx' }, step: 'issue again', server: 'nginx', block: 'an nginx deny' },
    { name: 'issue apache', context: { action: 'issue', webServer: 'apache' }, step: 'issue again', server: 'Apache', block: 'an Apache .htaccess/deny rule' }
  ]

  describe.each(CONTEXTS)('$name', ({ context, step, server, block }) => {
    it('words the blocked challenge', () => {
      expect(renewalHint('GET /.well-known/acme-challenge/token returned 404', context)).toBe(
        `Let's Encrypt could not reach the challenge file (404). A Cloudflare rule or ${block} often blocks /.well-known/. Fix that, then ${step}.`
      )
    })

    it('words the DNS problem', () => {
      expect(renewalHint('DNS problem: NXDOMAIN looking up A for old.example.com', context)).toBe(
        `The name does not point to this server. Check its DNS record, then ${step}.`
      )
    })

    it('words the rate limit the same way', () => {
      expect(renewalHint('too many certificates (5) already issued', context)).toBe("This is a Let's Encrypt rate limit. Wait before retrying.")
    })

    it('names the web server for a blocked port 80', () => {
      expect(renewalHint('Timeout during connect (likely firewall problem)', context)).toBe(
        `Let's Encrypt could not connect to this server on port 80. Check the firewall and that ${server} is listening.`
      )
    })

    it('returns null for unknown output', () => {
      expect(renewalHint('Congratulations, all renewals succeeded.', context)).toBeNull()
    })
  })

  it('defaults to renewal on nginx', () => {
    expect(renewalHint('Connection refused')).toBe(renewalHint('Connection refused', { action: 'renewal', webServer: 'nginx' }))
    expect(renewalHint('SERVFAIL')).toContain('run Test renewal')
  })
})
