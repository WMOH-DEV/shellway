import { describe, expect, it } from 'vitest'
import { DAY, makeOrigin, NOW } from '../testReport'
import { failCheck, okCheck, verifyResult } from './testFixtures'
import { servedText, verifyProblems } from './verifyView'

describe('servedText', () => {
  it('shows the kind and days left', () => {
    expect(servedText(makeOrigin({ notAfter: NOW + 89 * DAY }), NOW)).toBe("Let's Encrypt · 89 days left")
  })

  it('says when nothing is served', () => {
    expect(servedText(null, NOW)).toBe('No certificate served')
    expect(servedText(makeOrigin({ kind: 'none' }), NOW)).toBe('No certificate served')
  })
})

describe('verifyProblems', () => {
  it('is empty when everything passed', () => {
    expect(verifyProblems(verifyResult())).toEqual([])
  })

  it('lists each failure in plain words', () => {
    const result = verifyResult({
      names: [{ name: 'app.example.com', served: null, https: failCheck('error 526 from Cloudflare') }],
      renewalTest: failCheck('port 80 refused'),
      timer: failCheck('')
    })
    expect(verifyProblems(result)).toEqual([
      'app.example.com does not serve a certificate yet',
      'app.example.com did not answer over HTTPS (error 526 from Cloudflare)',
      'The renewal test failed (port 80 refused)',
      'No renewal timer is scheduled'
    ])
  })

  it('does not count unknown checks as failures', () => {
    expect(verifyProblems(verifyResult({ renewalTest: { state: 'unknown', detail: '' }, timer: okCheck() }))).toEqual([])
  })
})
