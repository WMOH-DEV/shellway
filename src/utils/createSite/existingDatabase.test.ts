import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CreatedResources, RunRecord, SiteDatabase } from '@/types/createSite'
import { EXIT_REFUSED } from '../ssl/originCa/exitCodes'
import { MASK } from '../server/databases/identifiers'
import { checkExistingDatabaseScript, databaseEnv, existingDatabaseProblem, isExistingDbPassword, siteDatabase } from './database'
import { leftoversOf } from './deletion'
import { assertSecrets } from './env'
import { buildPlan } from './plan'
import { removalSteps } from './removal'
import { NGINX, allTools, baseInput } from './testFixtures'
import { commandsStepProblem, newDraft, toInput, toSecrets, type CreateSiteDraft, type ServerContext } from './wizard'

const EXISTING = { engine: 'mysql' as const, name: 'shop_live', user: 'shop_app' }
const DATABASE: SiteDatabase = { ...EXISTING, existing: true }
const PASSWORD = `p@ss w$rd"#!x`

const NO_RESOURCES: CreatedResources = { folder: null, repo: null, localCopy: null, siteFile: null, phpPool: null, database: null, envFile: null, jobs: null, modulesEnabled: [], dnsRecords: [], httpsSiteFile: null, certificate: null, deploySite: null }

describe('checkExistingDatabaseScript', () => {
  let bin = ''

  beforeEach(() => {
    bin = mkdtempSync(join(tmpdir(), 'existing-db-'))
    writeFileSync(join(bin, 'mysql'), ['#!/bin/sh', `printf '%s\\n' "$MYSQL_PWD" > "${bin}/password"`, `printf '%s\\n' "$*" > "${bin}/args"`, '[ -n "$LOGIN_OK" ]', ''].join('\n'))
    chmodSync(join(bin, 'mysql'), 0o755)
    writeFileSync(join(bin, 'runuser'), ['#!/bin/sh', `printf '%s\n' "$1 $2" > "${bin}/runuser"`, 'shift 3', 'exec "$@"', ''].join('\n'))
    chmodSync(join(bin, 'runuser'), 0o755)
  })

  afterEach(() => rmSync(bin, { recursive: true, force: true }))

  const run = (env: Record<string, string>) =>
    spawnSync('sh', ['-s'], { input: checkExistingDatabaseScript(EXISTING, PASSWORD), encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env } })

  it('logs in as the given user to the given database, passing the password outside the command line', () => {
    const result = run({ LOGIN_OK: '1' })
    expect(result.status).toBe(0)
    expect(readFileSync(join(bin, 'runuser'), 'utf8').trim()).toBe('-u nobody')
    expect(readFileSync(join(bin, 'password'), 'utf8').trim()).toBe(PASSWORD)
    const args = readFileSync(join(bin, 'args'), 'utf8')
    expect(args).toContain('-u shop_app -D shop_live')
    expect(args).not.toContain('w$rd')
  })

  it('stops the run with a clear message when it cannot log in', () => {
    const result = run({ LOGIN_OK: '' })
    expect(result.status).toBe(EXIT_REFUSED)
    expect(result.stderr).toContain('Could not log in to the MySQL database shop_live as shop_app')
  })

  it('never creates or drops anything', () => {
    expect(checkExistingDatabaseScript(EXISTING, PASSWORD)).not.toMatch(/CREATE|DROP|GRANT/i)
  })

  it('logs in to PostgreSQL over 127.0.0.1, the host the app uses', () => {
    expect(checkExistingDatabaseScript({ ...EXISTING, engine: 'postgresql' }, PASSWORD)).toContain("runuser -u nobody -- psql -X -h 127.0.0.1 -U 'shop_app' -d 'shop_live'")
  })
})

describe('existing database passwords', () => {
  it.each([['plain_password1', true], [PASSWORD, true], ["it's", false], ['back\\slash', false], [' padded', false], ['x'.repeat(129), false]])('%j is allowed: %s', (password, allowed) => {
    expect(isExistingDbPassword(password)).toBe(allowed)
  })

  it('writes a password with symbols to the env file in quotes, and a plain one as it is', () => {
    expect(databaseEnv(DATABASE, PASSWORD)).toContainEqual(['DB_PASSWORD', `'${PASSWORD}'`])
    expect(databaseEnv(DATABASE, 'plain_password1')).toContainEqual(['DB_PASSWORD', 'plain_password1'])
    expect(databaseEnv(DATABASE, MASK)).toContainEqual(['DB_PASSWORD', MASK])
  })

  it('accepts the password as a run secret', () => {
    const input = baseInput({ database: DATABASE })
    expect(assertSecrets(input, { dbPassword: PASSWORD, appKey: `base64:${'A'.repeat(43)}=`, envText: '' }).dbPassword).toBe(PASSWORD)
    expect(() => assertSecrets(input, { dbPassword: "it's", appKey: `base64:${'A'.repeat(43)}=`, envText: '' })).toThrow()
  })
})

describe('an existing database in the plan and on removal', () => {
  it('only checks the login in the plan', () => {
    const action = buildPlan(baseInput({ database: DATABASE }), allTools(), NGINX.driver).find((a) => a.id === 'database')
    expect(action?.chip).toBe('ready')
    expect(action?.summary).toBe('your existing MySQL database shop_live, user shop_app')
    expect(action?.script).not.toMatch(/CREATE|DROP/)
  })

  const record = (database: SiteDatabase): RunRecord => ({
    id: 'run-1',
    sessionId: 'session-1',
    domain: 'shop.example.com',
    createdAt: 1_800_000_000_000,
    server: NGINX.server,
    input: baseInput({ database }),
    steps: [],
    created: { ...NO_RESOURCES, database },
    phase: 'failed',
    current: null,
    error: null,
    deployKey: null
  })

  it('is never removed or listed as left behind, even if a record names it', () => {
    expect(removalSteps(record(DATABASE), NGINX.driver).some((step) => step.kind === 'database')).toBe(false)
    expect(leftoversOf(record(DATABASE)).some((item) => item.id === 'database')).toBe(false)
  })
})

describe('choosing an existing database in the wizard', () => {
  const context = { server: NGINX.server, tools: allTools(), serverIp: '203.0.113.10', owner: 'deploy', siteUsers: null, fullSudo: true, zones: [], dnsEdit: true, deploySiteNames: [] } as unknown as ServerContext
  const draft = (overrides: Partial<CreateSiteDraft> = {}): CreateSiteDraft => ({
    ...newDraft(allTools()),
    template: 'laravel',
    domain: 'shop.example.com',
    siteName: 'shop',
    folder: '/var/www/shop',
    repoUrl: 'git@github.com:acme/shop.git',
    email: 'admin@example.com',
    database: 'existing',
    existingDatabase: EXISTING,
    existingDbPassword: PASSWORD,
    ...overrides
  })

  it('asks for each missing detail', () => {
    expect(commandsStepProblem(draft({ existingDatabase: { ...EXISTING, name: '' } }), allTools(), NGINX.server)).toMatch(/database name/)
    expect(commandsStepProblem(draft({ existingDatabase: { ...EXISTING, user: '' } }), allTools(), NGINX.server)).toMatch(/database user/)
    expect(commandsStepProblem(draft({ existingDbPassword: '' }), allTools(), NGINX.server)).toMatch(/password/)
    expect(commandsStepProblem(draft({ ownAppKey: 'not-a-key' }), allTools(), NGINX.server)).toMatch(/app key/)
    expect(commandsStepProblem(draft({ codeSource: 'new' }), allTools(), NGINX.server)).toMatch(/new project can't use an existing database/)
    expect(commandsStepProblem(draft(), allTools(), NGINX.server)).toBeNull()
  })

  it('sends the existing database, its password and your app key to the run', () => {
    const appKey = `base64:${'B'.repeat(43)}=`
    const d = draft({ ownAppKey: appKey })
    const input = toInput(d, context, null)
    expect(input.database).toEqual(DATABASE)
    expect(toSecrets(d, input)).toMatchObject({ dbPassword: PASSWORD, appKey })
  })

  it('uses the generated app key when you leave yours empty', () => {
    const d = draft()
    expect(toSecrets(d, toInput(d, context, null)).appKey).toBe(d.appKey)
  })

  it('builds the existing database only from the existing choice', () => {
    expect(siteDatabase('existing', { siteName: 'shop', folder: '/var/www/shop' }, EXISTING)).toEqual(DATABASE)
    expect(existingDatabaseProblem(EXISTING, PASSWORD)).toBeNull()
  })
})
