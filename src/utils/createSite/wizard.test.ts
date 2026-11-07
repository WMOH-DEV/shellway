import { describe, expect, it } from 'vitest'
import type { CreateSiteContext, NameCheck } from '@/types/createSite'
import { buildPlan } from './plan'
import { NGINX, allTools, baseInput } from './testFixtures'
import {
  codeStepProblem,
  dnsInput,
  domainStepProblem,
  newDraft,
  siteNameFromDomain,
  siteStepProblem,
  stepForAction,
  toInput,
  type CreateSiteDraft,
  type NameCheckState,
  type ServerContext
} from './wizard'

const context = (overrides: Partial<CreateSiteContext> = {}): ServerContext => ({
  server: { kind: 'nginx' },
  tools: allTools(),
  serverIp: '203.0.113.10',
  owner: 'deploy',
  fullSudo: true,
  zones: [{ id: 'zone-1', name: 'example.com' }],
  dnsEdit: true,
  deploySiteNames: ['blog'],
  ...overrides
} as ServerContext)

const ZONE = { id: 'zone-1', name: 'example.com' }
const FREE: NameCheck = { zone: ZONE, records: [], servedBy: null }

const draft = (overrides: Partial<CreateSiteDraft> = {}): CreateSiteDraft => ({
  ...newDraft(allTools()),
  domain: 'shop.example.com',
  siteName: 'shop',
  folder: '/var/www/shop',
  repoUrl: 'git@github.com:acme/shop.git',
  email: 'admin@example.com',
  ...overrides
})

const checked = (result: Partial<NameCheck> = {}, domain = 'shop.example.com'): NameCheckState => ({ domain, result: { ...FREE, ...result }, error: null })

describe('newDraft', () => {
  it('starts on the first template the server can run, with its PHP version', () => {
    expect(newDraft(allTools()).template).toBe('laravel')
    expect(newDraft(allTools()).phpVersion).toBe('8.3')
    expect(newDraft(allTools({ php: { installed: [], installable: [], missingPackages: {} }, node: null })).template).toBe('static')
  })
})

describe('siteNameFromDomain', () => {
  it('takes the first label of the domain', () => {
    expect(siteNameFromDomain('shop.example.com')).toBe('shop')
    expect(siteNameFromDomain('Example.com')).toBe('example')
  })
})

describe('siteStepProblem', () => {
  it('passes a free name with a usable template', () => {
    expect(siteStepProblem(draft(), checked(), context())).toBeNull()
  })

  it('blocks a name that already has DNS records or is already served', () => {
    expect(siteStepProblem(draft(), checked({ records: [{ type: 'A', name: 'shop.example.com', content: '198.51.100.7' }] }), context())).toMatch(/already has DNS records/)
    expect(siteStepProblem(draft(), checked({ servedBy: '/etc/nginx/sites-enabled/old.conf' }), context())).toMatch(/already served by/)
  })

  it('waits for a check of the current domain', () => {
    expect(siteStepProblem(draft(), null, context())).toMatch(/Checking/)
    expect(siteStepProblem(draft(), checked({}, 'old.example.com'), context())).toMatch(/Checking/)
    expect(siteStepProblem(draft(), { domain: 'shop.example.com', result: null, error: 'No connection' }, context())).toBe('No connection')
  })

  it('blocks bad names, taken site names, blocked templates and missing ports', () => {
    expect(siteStepProblem(draft({ domain: 'not a domain' }), checked(), context())).toMatch(/Enter a domain/)
    expect(siteStepProblem(draft({ siteName: 'blog' }), checked(), context())).toMatch(/already a site named blog/)
    expect(siteStepProblem(draft({ folder: 'www/shop' }), checked(), context())).toMatch(/full path/)
    expect(siteStepProblem(draft({ template: 'compose' }), checked(), context({ tools: allTools({ docker: false }) }))).toMatch(/docker not installed/)
    expect(siteStepProblem(draft({ template: 'node', appPort: 0 }), checked(), context())).toMatch(/app port/)
  })
})

describe('code and domain steps', () => {
  it('needs a repository, a branch and a sane check interval', () => {
    expect(codeStepProblem(draft())).toBeNull()
    expect(codeStepProblem(draft({ repoUrl: '' }))).toMatch(/repository/)
    expect(codeStepProblem(draft({ branch: '' }))).toMatch(/branch/)
    expect(codeStepProblem(draft({ pollMinutes: 0 }))).toMatch(/every 1 to 60/)
    expect(codeStepProblem(draft({ pollMinutes: 0, sourceMode: 'pc' }))).toBeNull()
  })

  it("needs an email for Let's Encrypt", () => {
    expect(domainStepProblem(draft())).toBeNull()
    expect(domainStepProblem(draft({ email: 'nope' }))).toMatch(/email/)
  })
})

describe('dnsInput', () => {
  it('uses the zone when the token can edit DNS', () => {
    expect(dnsInput(draft(), context(), ZONE)).toEqual({ zoneId: 'zone-1', zoneName: 'example.com', serverIp: '203.0.113.10', proxied: true })
  })

  it('falls back to a manual record without a zone or without DNS Edit', () => {
    const manual = { zoneId: null, zoneName: null, serverIp: '203.0.113.10', proxied: false }
    expect(dnsInput(draft(), context(), null)).toEqual(manual)
    expect(dnsInput(draft(), context({ dnsEdit: false }), ZONE)).toEqual(manual)
  })

  it('has nothing to point at without the server address', () => {
    expect(dnsInput(draft(), context({ serverIp: null }), ZONE)).toBeNull()
  })
})

describe('toInput', () => {
  it('builds the same input the plan tests use', () => {
    expect(toInput(draft({ pollMinutes: 2 }), context(), ZONE)).toEqual(baseInput())
  })

  it('feeds buildPlan without throwing', () => {
    const input = toInput(draft(), context(), ZONE)
    expect(() => buildPlan(input, allTools(), NGINX.driver)).not.toThrow()
  })
})

describe('stepForAction', () => {
  it('sends each plan card back to the step that edits it', () => {
    expect(stepForAction('modules')).toBe('site')
    expect(stepForAction('dns')).toBe('domain')
    expect(stepForAction('deploys')).toBe('code')
  })
})
