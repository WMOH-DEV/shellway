import { describe, expect, it } from 'vitest'
import { makeBlock } from '../testReport'
import type { NameReadiness } from '../../../types/ssl'
import { leftOutByDns, nameChoices, selectedNames } from './names'

const ok = { state: 'ok', detail: '' } as const
const row = (name: string, dnsState: 'ok' | 'fail' | 'unknown', detail = ''): NameReadiness => ({
  name, dns: { state: dnsState, detail }, port80: ok, cloudflare: null
})

const block = makeBlock({ names: ['app.example.com', 'www.app.example.com', '*.example.com', '~^api\\d+\\.example\\.com$', '.example.net', 'old.example.com'] })

describe('names', () => {
  it('marks wildcard, regex and leading-dot names as not issuable', () => {
    expect(nameChoices(block).map((c) => c.issuable)).toEqual([true, true, false, false, false, true])
  })

  it('selects issuable names whose DNS did not fail and that the user left ticked', () => {
    const readiness = [row('app.example.com', 'ok'), row('www.app.example.com', 'ok'), row('old.example.com', 'fail', 'points to 198.51.100.7, not this server')]
    expect(selectedNames(nameChoices(block), readiness, new Set())).toEqual(['app.example.com', 'www.app.example.com'])
    expect(selectedNames(nameChoices(block), readiness, new Set(['www.app.example.com']))).toEqual(['app.example.com'])
  })

  it('lists the names DNS left out', () => {
    const readiness = [row('app.example.com', 'ok'), row('old.example.com', 'fail', 'points to 198.51.100.7, not this server'), row('other.example.net', 'fail')]
    expect(leftOutByDns(nameChoices(block), readiness).map((r) => r.name)).toEqual(['old.example.com'])
  })
})
