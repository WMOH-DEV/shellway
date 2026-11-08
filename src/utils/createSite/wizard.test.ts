import { describe, expect, it } from 'vitest'
import type { CreateSiteContext, NameCheck } from '@/types/createSite'
import { buildPlan } from './plan'
import type { StackSuggestion } from './repoSuggest'
import { NGINX, allTools, baseInput } from './testFixtures'
import {
  commandsKey,
  commandsOf,
  commandsStepProblem,
  dnsInput,
  projectCheckKey,
  domainStepProblem,
  newDraft,
  siteNameFromDomain,
  siteStepProblem,
  stackStepProblem,
  stepForAction,
  suggestedDraft,
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
  it('turns on only the Laravel jobs the server can run', () => {
    expect(newDraft(allTools({ cron: false })).jobs).toEqual({ scheduler: false, queueWorker: true })
  })

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
    expect(siteStepProblem(draft(), checked({ records: [{ type: 'A', name: 'shop.example.com', content: '198.51.100.7' }] }), context())).toMatch(/already has DNS records that point somewhere else/)
    expect(siteStepProblem(draft(), checked({ servedBy: '/etc/nginx/sites-enabled/old.conf' }), context())).toMatch(/already served by/)
  })

  it('accepts records that already point at this server, the way Shellway would make them', () => {
    const records = [{ type: 'A', name: 'shop.example.com', content: '203.0.113.10' }, { type: 'CNAME', name: 'www.shop.example.com', content: 'shop.example.com' }]
    expect(siteStepProblem(draft(), checked({ records }), context())).toBeNull()
    expect(siteStepProblem(draft(), checked({ records: [{ type: 'AAAA', name: 'shop.example.com', content: '2001:db8::1' }, records[0]] }), context())).toMatch(/point somewhere else/)
  })

  it('ignores a www record when the site does not use www', () => {
    const records = [{ type: 'A', name: 'www.shop.example.com', content: '198.51.100.7' }]
    expect(siteStepProblem(draft({ includeWww: false }), checked({ records }), context())).toBeNull()
    expect(siteStepProblem(draft({ includeWww: true }), checked({ records }), context())).toMatch(/point somewhere else/)
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

  it('needs a safe output folder and Node.js to build a static site', () => {
    const built = (outputDir: string) => draft({ template: 'static', staticBuild: true, outputDir })
    expect(stackStepProblem(built('../dist'), context())).toMatch(/folder the build writes to/)
    expect(stackStepProblem(built('dist'), context({ tools: allTools({ node: null }) }))).toMatch(/Node.js is not installed/)
    expect(stackStepProblem(built('dist'), context())).toBeNull()
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

describe('code sources', () => {
  const NEW_GITHUB: Partial<CreateSiteDraft> = { codeSource: 'new', repoKind: 'github', githubOwner: 'acme', localParent: ' /home/dev/Projects ', repoUrl: '' }
  const siteProblem = (overrides: Partial<CreateSiteDraft>, problem: string | null = null) => {
    const value = draft(overrides)
    return siteStepProblem(value, checked(), context(), { key: projectCheckKey(value), problem })
  }

  it('needs a GitHub login, a valid name and a folder on this PC for a new project', () => {
    expect(siteProblem(NEW_GITHUB)).toBeNull()
    expect(siteProblem({ ...NEW_GITHUB, githubOwner: '' })).toMatch(/Connect GitHub/)
    expect(siteProblem({ ...NEW_GITHUB, repoName: 'my repo' })).toMatch(/Repository name/)
    expect(siteProblem({ ...NEW_GITHUB, localParent: '  ' })).toMatch(/Choose where the project goes/)
    expect(siteProblem({ ...NEW_GITHUB, repoKind: 'empty' })).toMatch(/URL of the empty repository/)
  })

  it('waits for the check of the current repository and folder, and shows what it found', () => {
    expect(siteStepProblem(draft(NEW_GITHUB), checked(), context(), null)).toMatch(/Checking the repository/)
    expect(siteStepProblem(draft(NEW_GITHUB), checked(), context(), { key: projectCheckKey(draft({ ...NEW_GITHUB, repoName: 'old' })), problem: null })).toMatch(/Checking the repository/)
    expect(siteProblem(NEW_GITHUB, '/home/dev/Projects/shop already exists')).toBe('/home/dev/Projects/shop already exists')
  })

  it('needs nothing about code for a site without code', () => {
    expect(siteStepProblem(draft({ codeSource: 'none', repoUrl: '', branch: '' }), checked(), context())).toBeNull()
  })

  it('offers only the stacks each code source can use', () => {
    expect(stackStepProblem(draft({ codeSource: 'new', template: 'compose' }), context())).toMatch(/cannot start as a new project/)
    expect(stackStepProblem(draft({ codeSource: 'none', template: 'laravel' }), context())).toMatch(/Static site or PHP/)
    expect(stackStepProblem(draft({ codeSource: 'none', template: 'static' }), context())).toBeNull()
  })

  it('needs a database for Laravel, and no commands for a site without code', () => {
    expect(commandsStepProblem(draft({ database: 'none' }), allTools(), NGINX.server)).toMatch(/pick a database/)
    expect(commandsStepProblem(draft({ template: 'php', database: 'none' }), allTools(), NGINX.server)).toBeNull()
    expect(commandsStepProblem(draft({ codeSource: 'none', database: 'none' }), allTools(), NGINX.server)).toBeNull()
  })

  it('flags edited commands once an earlier setting changes what the defaults would be', () => {
    const edited = (base: CreateSiteDraft) => ({ ...base, commands: { ...commandsOf(base, NGINX.server), activateSteps: [] }, commandsBasis: commandsKey(base, NGINX.server) })
    const php82 = edited(draft({ phpVersion: '8.2' }))
    expect(commandsStepProblem(php82, allTools(), NGINX.server)).toBeNull()
    const moved = { ...php82, phpVersion: '8.3' }
    expect(commandsStepProblem(moved, allTools(), NGINX.server)).toMatch(/Earlier settings changed/)
    expect(commandsStepProblem({ ...moved, commandsBasis: commandsKey(moved, NGINX.server) }, allTools(), NGINX.server)).toBeNull()
  })

  it('never adds the repository build to a new project', () => {
    const steps = (overrides: Partial<CreateSiteDraft>) => commandsOf(draft({ template: 'node', repoBuildScript: true, ...overrides }), NGINX.server).buildSteps.map((step) => step.command)
    expect(steps({})).toContain('npm run build')
    expect(steps({ codeSource: 'new' })).not.toContain('npm run build')
  })

  it('builds the input for a new GitHub project with the repository Shellway will create', () => {
    const input = toInput(draft({ ...NEW_GITHUB, repoName: 'shop-site', repoPrivate: false }), context(), ZONE)
    expect(input).toMatchObject({
      codeSource: 'new',
      newRepo: { kind: 'github', owner: 'acme', name: 'shop-site', private: false },
      repoUrl: 'git@github.com:acme/shop-site.git',
      localParent: '/home/dev/Projects'
    })
    expect(toInput(draft({ ...NEW_GITHUB, repoKind: 'empty', repoUrl: 'git@example.com:me/shop.git' }), context(), ZONE)).toMatchObject({ newRepo: { kind: 'empty' }, repoUrl: 'git@example.com:me/shop.git' })
  })

  it('builds the input for a site without code with no deploys, database, env file or jobs', () => {
    const input = toInput(draft({ codeSource: 'none', template: 'static' }), context(), ZONE)
    expect(input).toMatchObject({ codeSource: 'none', newRepo: null, localParent: null, repoUrl: '', buildSteps: [], activateSteps: [], database: null, env: false, jobs: { scheduler: false, queueWorker: false } })
    expect(() => buildPlan(input, allTools(), NGINX.driver)).not.toThrow()
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
    expect(toInput(draft({ pollMinutes: 2 }), context(), ZONE)).toEqual(baseInput({ jobs: { scheduler: true, queueWorker: true } }))
  })

  it('keeps the scheduler and queue worker only for Laravel on a server that can run them', () => {
    expect(toInput(draft({ template: 'php' }), context(), ZONE).jobs).toEqual({ scheduler: false, queueWorker: false })
    expect(toInput(draft(), context({ tools: allTools({ systemd: false }) }), ZONE).jobs).toEqual({ scheduler: true, queueWorker: false })
  })

  it('uses the commands the user edited, without blank ones', () => {
    const commands = { buildSteps: [{ command: '  composer install  ', optional: false, timeoutSeconds: null }, { command: ' ', optional: false, timeoutSeconds: null }], activateSteps: [] }
    const input = toInput(draft({ commands }), context(), ZONE)
    expect(input.buildSteps).toEqual([{ command: 'composer install', optional: false, timeoutSeconds: null }])
    expect(input.activateSteps).toEqual([])
  })

  it('builds a static site with npm only when the user asks, serving the output folder', () => {
    const built = draft({ template: 'static', staticBuild: true, outputDir: ' dist ', spa: true })
    const input = toInput(built, context(), ZONE)
    expect(input).toMatchObject({ buildOutput: 'dist', spa: true })
    expect(input.buildSteps.map((step) => step.command)).toEqual(['npm ci', 'npm run build'])
    expect(input).not.toHaveProperty('staticBuild')
    expect(input).not.toHaveProperty('outputDir')
    expect(toInput(draft({ template: 'static' }), context(), ZONE)).toMatchObject({ buildOutput: null, spa: false, buildSteps: [] })
    expect(toInput(draft({ staticBuild: true, spa: true }), context(), ZONE)).toMatchObject({ buildOutput: null, spa: false })
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

describe('suggestedDraft', () => {
  const suggestion = (overrides: Partial<StackSuggestion> = {}): StackSuggestion =>
    ({ template: 'laravel', reason: '', phpMinimum: null, buildScript: false, outputDir: null, envExample: null, ...overrides })

  it('switches the stack, resets its commands and database, and fills the env from .env.example once', () => {
    const changes = suggestedDraft(draft({ template: 'node', database: 'none' }), suggestion({ envExample: 'APP_NAME=Shop\n' }), allTools())
    expect(changes).toMatchObject({ template: 'laravel', commands: null, database: 'mysql', envText: 'APP_NAME=Shop\n' })
    expect(suggestedDraft(draft({ envText: 'MINE=1' }), suggestion({ envExample: 'APP_NAME=Shop\n' }), allTools())).not.toHaveProperty('envText')
  })

  it('replaces what it suggested for another repository, but never what the user wrote', () => {
    const fromA = draft({ envText: 'VITE_A=1\n', suggestedEnvText: 'VITE_A=1\n', template: 'static', staticBuild: true })
    expect(suggestedDraft(fromA, suggestion({ template: 'static', envExample: null }), allTools())).toMatchObject({ envText: '', staticBuild: false })
    expect(suggestedDraft({ ...fromA, envText: 'VITE_A=2\n' }, suggestion({ template: 'static' }), allTools())).not.toHaveProperty('envText')
  })

  it('keeps the chosen database when the stack does not change', () => {
    expect(suggestedDraft(draft({ database: 'sqlite' }), suggestion(), allTools()).database).toBe('sqlite')
  })

  it('picks a PHP version new enough for composer.json', () => {
    const tools = allTools({ php: { installed: ['8.3', '8.1'], installable: [], missingPackages: {}, drivers: {} } })
    expect(suggestedDraft(draft({ phpVersion: '8.1' }), suggestion({ phpMinimum: '8.2' }), tools).phpVersion).toBe('8.3')
  })

  it('adds the npm build to Laravel only when the server has Node.js', () => {
    const withBuild = (tools: ReturnType<typeof allTools>) => {
      const next = { ...draft(), ...suggestedDraft(draft(), suggestion({ buildScript: true }), tools) }
      return toInput(next, context({ tools }), ZONE).buildSteps.map((step) => step.command)
    }
    expect(withBuild(allTools())).toEqual(expect.arrayContaining(['npm ci', 'npm run build']))
    expect(withBuild(allTools({ node: null }))).not.toContain('npm ci')
  })

  it('turns on the npm build for a Vite site', () => {
    expect(suggestedDraft(draft(), suggestion({ template: 'static', outputDir: 'dist' }), allTools())).toMatchObject({ template: 'static', staticBuild: true, outputDir: 'dist' })
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
