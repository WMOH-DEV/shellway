import { describe, expect, it, vi } from 'vitest'
import type { CreateSiteInput, RunRecord } from '../../../src/types/createSite'
import type { ServerFacts } from '../../../src/types/ssl'
import { buildPlan } from '../../../src/utils/createSite/plan'
import { NGINX, allTools, baseInput } from '../../../src/utils/createSite/testFixtures'
import type { DeployCoordinator } from '../deploy/DeployCoordinator'
import type { SslCoordinator } from '../ssl/SslCoordinator'
import { newRunRecord } from './CreateSiteRun'
import { CreateSiteService } from './CreateSiteService'
import type { ProjectPort } from './ports'
import type { RunStore } from './RunStore'

const INPUT = baseInput({ dns: { zoneId: 'z1', zoneName: 'example.com', serverIp: '203.0.113.10', proxied: true } })
const SECRETS = { dbPassword: 'Pw7kQ2mZx9RtLb4NcV8sHj3D', appKey: `base64:${'A'.repeat(42)}Q=`, envText: '' }

function fakeStore(records: RunRecord[]): RunStore {
  const runs = new Map(records.map((record) => [record.id, record]))
  return {
    get: (id: string) => runs.get(id) ?? null,
    forSession: (sessionId: string) => [...runs.values()].filter((run) => run.sessionId === sessionId),
    save: vi.fn((record: RunRecord) => { runs.set(record.id, record) }),
    saveSecrets: vi.fn(),
    secrets: () => null
  } as unknown as RunStore
}

const MACHINE = '0123456789abcdef0123456789abcdef'

function makeService(store: RunStore, facts: Partial<ServerFacts> = {}, machine = MACHINE) {
  const ssl = {
    service: () => ({ readConfig: async () => ({ facts: { nginx: '1.24', apache: null, serving: 'nginx', user: 'deploy', ...facts }, blocks: [] }) }),
    cloudflareStatus: async () => ({ saved: true, error: null, zones: [{ id: 'z1', name: 'example.com' }], permissions: [] }),
    dnsClient: () => null
  } as unknown as SslCoordinator
  return new CreateSiteService({
    execFor: () => vi.fn(async (command: string) => ({ code: 0, stdout: command.includes('machine-id') ? `${machine}\n` : '', stderr: '', stdoutBytes: 0 })),
    sessionOf: () => 'session-1',
    ssl,
    deploy: {} as DeployCoordinator,
    project: {} as ProjectPort,
    store,
    broadcast: vi.fn(),
    newId: () => 'run-new',
    now: () => 1
  })
}

function storedRun(changes: Partial<RunRecord>): RunRecord {
  const record = newRunRecord('run-1', 'session-1', INPUT, buildPlan(INPUT, allTools(), NGINX.driver), 1)
  return { ...record, ...changes }
}

describe('CreateSiteService', () => {
  it('marks a run that was mid-step when Shellway closed as failed at that step', () => {
    const running = storedRun({ phase: 'running', current: 'site' })
    running.steps = running.steps.map((step) => (step.id === 'site' ? { ...step, startedAt: 5 } : step.id === 'folder' ? { ...step, status: 'done' } : step))
    const store = fakeStore([running])
    const [run] = makeService(store).runs('session-1')
    expect(run.phase).toBe('failed')
    expect(run.error).toContain('Shellway closed while this step was running')
    expect(run.steps.find((step) => step.id === 'site')?.status).toBe('failed')
    expect(store.save).toHaveBeenCalledWith(run)
  })

  it('lets a run that was removing when Shellway closed be removed again', () => {
    const [run] = makeService(fakeStore([storedRun({ phase: 'removing' })])).runs('session-1')
    expect(run.phase).toBe('remove-failed')
  })

  it('refuses to resume or remove a run from a different server connection', async () => {
    const service = makeService(fakeStore([storedRun({ phase: 'failed', sessionId: 'session-2' })]))
    expect(() => service.resume('c1', 'run-1', 'retry')).toThrow('different server connection')
    await expect(service.remove('c1', 'run-1')).rejects.toThrow('different server connection')
  })

  it('refuses to start when the web server is not the one the wizard saw', async () => {
    const service = makeService(fakeStore([]), { nginx: null, apache: { layout: 'debian' } as ServerFacts['apache'], serving: 'apache' })
    await expect(service.start('c1', 'session-1', INPUT, SECRETS)).rejects.toThrow('The web server on this server changed')
  })

  it.each<[string, CreateSiteInput['dns']]>([
    ['Invalid Cloudflare zone', { zoneId: 'z1; rm', zoneName: 'example.com', serverIp: '203.0.113.10', proxied: true }],
    ['not on the connected account', { zoneId: 'z2', zoneName: 'example.com', serverIp: '203.0.113.10', proxied: true }],
    ['not on the connected account', { zoneId: 'z1', zoneName: 'example.org', serverIp: '203.0.113.10', proxied: true }]
  ])('refuses a zone that does not match the account: %s', async (message, dns) => {
    await expect(makeService(fakeStore([])).start('c1', 'session-1', { ...INPUT, dns }, SECRETS)).rejects.toThrow(message)
  })

  it.each<[string, unknown]>([
    ['password does not match', { ...SECRETS, dbPassword: null }],
    ['password is not valid', { ...SECRETS, dbPassword: "x'; DROP USER root; --" }],
    ['app key is not valid', { ...SECRETS, appKey: 'base64:short' }],
    ['Invalid secrets', null]
  ])('refuses secrets that do not fit the site: %s', async (message, secrets) => {
    await expect(makeService(fakeStore([])).start('c1', 'session-1', INPUT, secrets)).rejects.toThrow(message)
  })

  it('refuses a database whose names or path were not made from the site name', async () => {
    const input = { ...INPUT, database: { engine: 'mysql' as const, name: 'mysql', user: 'root' } }
    await expect(makeService(fakeStore([])).start('c1', 'session-1', input, SECRETS)).rejects.toThrow('Invalid database settings')
  })

  it('refuses a domain outside the chosen zone', async () => {
    await expect(makeService(fakeStore([])).start('c1', 'session-1', { ...INPUT, domain: 'shop.example.org' }, SECRETS)).rejects.toThrow('is not in the example.com zone')
  })

  const NEW_PROJECT: Partial<CreateSiteInput> = { codeSource: 'new', newRepo: { kind: 'github', owner: 'acme', name: 'shop', private: true }, localParent: '/home/dev/Projects' }

  it.each<[string, Partial<CreateSiteInput>]>([
    ['Invalid code settings', { localParent: '/home/dev/Projects' }],
    ['Invalid code source', { codeSource: 'zip' as CreateSiteInput['codeSource'] }],
    ['Invalid new project settings', { ...NEW_PROJECT, localParent: 'Projects' }],
    ['Invalid new project settings', { ...NEW_PROJECT, newRepo: null }],
    ['compose cannot start as a new project', { ...NEW_PROJECT, template: 'compose', database: null }],
    ['Invalid new repository settings', { ...NEW_PROJECT, repoUrl: 'git@github.com:someone-else/shop.git' }],
    ['Invalid new repository settings', { ...NEW_PROJECT, newRepo: { kind: 'github', owner: 'acme', name: 'shop;rm', private: true } }],
    ['Invalid settings for a site without code', { codeSource: 'none', template: 'laravel' }],
    ['Invalid settings for a site without code', { codeSource: 'none', template: 'static', database: null, env: false, buildSteps: [{ command: 'npm run build', optional: false, timeoutSeconds: null }], activateSteps: [] }]
  ])('refuses code settings that do not fit together: %s', async (message, changes) => {
    const input = { ...INPUT, ...changes }
    const secrets = { dbPassword: input.database === null ? null : SECRETS.dbPassword, appKey: input.template === 'laravel' ? SECRETS.appKey : null, envText: '' }
    await expect(makeService(fakeStore([])).start('c1', 'session-1', input, secrets)).rejects.toThrow(message)
  })

  describe('deleting a finished site', () => {
    const finished = (changes: Partial<RunRecord> = {}) => storedRun({ phase: 'done', machineId: MACHINE, ...changes })

    it('records which server a new site is made on', async () => {
      const facts = { paths: { apache: null }, sudo: { full: true, apache: false } } as unknown as Partial<ServerFacts>
      const record = await makeService(fakeStore([]), facts).start('c1', 'session-1', INPUT, SECRETS)
      expect(record.machineId).toBe(MACHINE)
    })

    it('lists finished sites but not removed ones', () => {
      const store = fakeStore([finished(), storedRun({ id: 'run-2', phase: 'removed' })])
      expect(makeService(store).runs('session-1').map((run) => run.id)).toEqual(['run-1'])
    })

    it('deletes a finished site on the same server once its name is typed', async () => {
      const store = fakeStore([finished()])
      const record = await makeService(store).deleteSite('c1', 'run-1', 'shop')
      expect(record).toMatchObject({ phase: 'removed', deleting: true })
    })

    it.each<[string, Partial<RunRecord>, string, string]>([
      ['a run that is not finished', { phase: 'failed' }, 'shop', 'Only a site that Create site finished'],
      ['a removal that was not a delete', { phase: 'remove-failed' }, 'shop', 'Only a site that Create site finished'],
      ['the wrong typed name', {}, 'shop2', 'Type shop to confirm'],
      ['another connection', { sessionId: 'session-2' }, 'shop', 'different server connection'],
      ['a run from before the server was recorded', { machineId: undefined }, 'shop', 'before Shellway recorded which server'],
      ['a run whose server had no readable machine ID', { machineId: null }, 'shop', 'could not read the machine ID'],
      ['a different server behind the same connection', { machineId: 'f'.repeat(32) }, 'shop', 'different server than the one this site was made on'],
      ['a login as another user than the site owner', { input: { ...INPUT, owner: 'someone' } }, 'shop', 'belongs to someone, but Shellway is logged in as deploy']
    ])('refuses %s and changes nothing', async (_what, changes, typed, message) => {
      const store = fakeStore([finished(changes)])
      await expect(makeService(store).deleteSite('c1', 'run-1', typed)).rejects.toThrow(message)
      expect(store.save).not.toHaveBeenCalled()
    })

    it('lets a delete that failed be tried again', async () => {
      const store = fakeStore([finished({ phase: 'remove-failed', deleting: true })])
      expect((await makeService(store).deleteSite('c1', 'run-1', 'shop')).phase).toBe('removed')
    })

    it('never runs the failed-run Remove on a finished site', async () => {
      await expect(makeService(fakeStore([finished()])).remove('c1', 'run-1')).rejects.toThrow('Use Delete site instead')
      await expect(makeService(fakeStore([finished({ phase: 'remove-failed', deleting: true })])).remove('c1', 'run-1')).rejects.toThrow('Use Delete site instead')
    })

    it('tells the user to try deleting again when Shellway closed mid-delete', () => {
      const [run] = makeService(fakeStore([finished({ phase: 'removing', deleting: true })])).runs('session-1')
      expect(run).toMatchObject({ phase: 'remove-failed', error: 'Shellway closed while deleting. Press Try deleting again to pick up from here.' })
    })
  })
})
