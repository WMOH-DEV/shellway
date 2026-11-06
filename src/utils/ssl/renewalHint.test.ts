import { describe, expect, it } from 'vitest'
import { renewalHint } from './renewalHint'

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
})
