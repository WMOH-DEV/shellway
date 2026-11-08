import { describe, expect, it } from 'vitest'
import type { CreateSiteContext, NameCheck } from '@/types/createSite'
import { buildPlan } from './plan'
import { NGINX, allTools, baseInput } from './testFixtures'
import {
  commandsOf,
  dnsInput,
  domainStepProblem,
  newDraft,
  siteNameFromDomain,
  siteStepProblem,
  stackStepProblem,
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
    expect(newDraft(allTools({ php: { installed: [], installable: [], missingPackages: {}, drivers: {} }, node: null })).template).toBe('static')
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
    expect(stackStepProblem(draft({ template: 'compose' }), context({ tools: allTools({ docker: false }) }))).toMatch(/docker not installed/)
    expect(stackStepProblem(draft({ template: 'node', appPort: 0 }), context())).toMatch(/app port/)
  })

  it('refuses a PHP stack when logged in as root, since PHP-FPM will not run a pool as root', () => {
    expect(stackStepProblem(draft(), context({ owner: 'root' }))).toMatch(/logged in as root/)
    expect(stackStepProblem(draft({ template: 'static' }), context({ owner: 'root' }))).toBeNull()
  })
})

describe('code and domain checks', () => {
  it('needs a repository, a branch and a sane check interval', () => {
    const problem = (overrides: Partial<CreateSiteDraft>) => siteStepProblem(draft(overrides), checked(), context())
    expect(problem({})).toBeNull()
    expect(problem({ repoUrl: '' })).toMatch(/repository/)
    expect(problem({ branch: '' })).toMatch(/branch/)
    expect(problem({ pollMinutes: 0 })).toMatch(/every 1 to 60/)
    expect(problem({ pollMinutes: 0, sourceMode: 'pc' })).toBeNull()
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

  it('uses the commands the user edited, without blank ones', () => {
    const commands = { buildSteps: [{ command: '  composer install  ', optional: false, timeoutSeconds: null }, { command: ' ', optional: false, timeoutSeconds: null }], activateSteps: [] }
    const input = toInput(draft({ commands }), context(), ZONE)
    expect(input.buildSteps).toEqual([{ command: 'composer install', optional: false, timeoutSeconds: null }])
    expect(input.activateSteps).toEqual([])
  })

  it('fills the stack defaults until the user edits them', () => {
    const { buildSteps, activateSteps } = commandsOf(draft(), { kind: 'nginx' })
    expect(buildSteps.map((step) => step.command)).toEqual(['php8.3 "$(command -v composer)" install --no-dev --optimize-autoloader --no-interaction', 'php8.3 artisan storage:link'])
    expect(activateSteps[0].command).toBe('php8.3 artisan migrate --force')
  })

  it('feeds buildPlan without throwing', () => {
    const input = toInput(draft(), context(), ZONE)
    expect(() => buildPlan(input, allTools(), NGINX.driver)).not.toThrow()
  })
})

describe('stepForAction', () => {
  it('sends each plan card back to the step that edits it', () => {
    expect(stepForAction('modules')).toBe('stack')
    expect(stepForAction('folder')).toBe('site')
    expect(stepForAction('dns')).toBe('domain')
    expect(stepForAction('deploys')).toBe('commands')
  })
})
