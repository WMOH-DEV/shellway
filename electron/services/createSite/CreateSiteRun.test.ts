import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateSiteInput, PlanActionId, RunRecord } from '../../../src/types/createSite'
import { buildPlan } from '../../../src/utils/createSite/plan'
import { FOLDER_CREATED, ROOT_SHELL } from '../../../src/utils/createSite/siteScripts'
import { APACHE_DEBIAN, NGINX, allTools, baseInput, type ServerCase } from '../../../src/utils/createSite/testFixtures'
import type { ExecOptions } from '../../utils/sshExec'
import { CreateSiteRun, dnsComment, newRunRecord } from './CreateSiteRun'
import type { CreateSitePorts } from './ports'
import { removeCreated } from './removeRun'

const SHA = 'a'.repeat(64)
const SHA_AFTER_HTTPS = 'b'.repeat(64)

interface Call {
  command: string
  stdin: string
}

type Failure = PlanActionId | 'none'

let calls: Call[]
let failAt: Failure
let httpsDone: boolean
let certificateOnServer: boolean
let saved: RunRecord[]
let output: string
let dnsCreated: number
let ports: CreateSitePorts

const ok = (stdout = '') => ({ code: 0, stdout, stderr: '', stdoutBytes: stdout.length })
const failed = (stderr: string) => ({ code: 3, stdout: '', stderr, stdoutBytes: 0 })

function answer(command: string, stdin: string) {
  if (command !== ROOT_SHELL) return ok()
  if (stdin.includes('/etc/letsencrypt/renewal/')) return ok(certificateOnServer ? 'shellway: certificate exists\n' : '')
  if (stdin.includes('sha256sum')) return stdin.includes('-le-ssl') && !httpsDone ? ok('shellway: not there\n') : ok(`${httpsDone ? SHA_AFTER_HTTPS : SHA}  file\n`)
  if (stdin.includes(FOLDER_CREATED)) return failAt === 'folder' ? failed('/var/www/shop already exists. Nothing was changed.') : ok(`${FOLDER_CREATED}\n`)
  if (stdin.includes('a2enmod')) return failAt === 'modules' ? failed('ERROR: Module x does not exist!') : ok()
  if (stdin.includes('undo_site')) return failAt === 'site' ? failed('nginx rejected the new site. It was removed.') : ok()
  return ok()
}

function makePorts(): CreateSitePorts {
  const exec = vi.fn(async (command: string, options: ExecOptions = {}) => {
    const stdin = typeof options.stdin === 'string' ? options.stdin : ''
    calls.push({ command, stdin })
    return answer(command, stdin)
  })
  return {
    exec,
    dns: {
      find: vi.fn(async () => []),
      create: vi.fn(async (_zone, record) => {
        if (failAt === 'dns') throw new Error('Cloudflare refused the record')
        dnsCreated += 1
        return { id: `rec-${dnsCreated}`, type: record.type, name: record.name, content: record.content, proxied: record.proxied, comment: record.comment }
      }),
      remove: vi.fn(async () => {})
    },
    deploy: {
      ensureRunner: vi.fn(async () => {}),
      siteNames: vi.fn(async () => []),
      save: vi.fn(async () => { if (failAt === 'deploys') throw new Error('Could not save the site') }),
      remove: vi.fn(async () => {}),
      keygen: vi.fn(async () => 'ssh-ed25519 AAAAexample shellway'),
      repoError: vi.fn(async () => null),
      deployAndWait: vi.fn(async () => ({ id: 'd1', status: failAt === 'first-deploy' ? 'failed' : 'success', trigger: 'manual', commit: 'abc', started: 1, finished: 2, warnings: 0, note: failAt === 'first-deploy' ? 'health check failed' : '', subject: '' }) as const)
    },
    tools: vi.fn(async () => allTools({ apacheModules: ['proxy', 'proxy_http', 'headers', 'ssl'] })),
    siteBlockId: vi.fn(async () => 'shop.conf:1'),
    issue: vi.fn(async () => {
      if (failAt === 'https') return { ok: false, failedStage: 'staging', restored: false, backupPath: null, lineage: null, output: '', hint: 'Port 80 is blocked' } as const
      httpsDone = true
      return { ok: true, failedStage: null, restored: false, backupPath: null, lineage: 'shop.example.com', output: '', hint: null } as const
    }),
    resolves: vi.fn(async () => true),
    save: (record) => { saved.push(record) },
    output: (chunk) => { output += chunk },
    now: () => 1_800_000_000_000
  }
}

function startRun(c: ServerCase, input: Partial<CreateSiteInput> = {}): CreateSiteRun {
  const full = baseInput({ server: c.server, ...input })
  const plan = buildPlan(full, allTools({ apacheModules: ['proxy', 'proxy_http', 'headers', 'ssl'] }), c.driver)
  return new CreateSiteRun(newRunRecord('run-1', 'session-1', full, plan, 1_800_000_000_000), ports, c.driver)
}

const statuses = (record: RunRecord) => Object.fromEntries(record.steps.map((step) => [step.id, step.status]))

beforeEach(() => {
  calls = []
  failAt = 'none'
  httpsDone = false
  certificateOnServer = false
  saved = []
  output = ''
  dnsCreated = 0
  ports = makePorts()
})

describe('CreateSiteRun', () => {
  it('runs every action once, in order, and records what it created', async () => {
    const record = await startRun(NGINX).run('start')
    expect(record.phase).toBe('done')
    expect(Object.values(statuses(record))).toEqual(['done', 'done', 'done', 'done', 'done', 'done'])
    expect(record.created).toEqual({
      folder: { path: '/var/www/shop', createdByRun: true },
      siteFile: { path: '/etc/nginx/sites-available/shop.conf', enabledLink: '/etc/nginx/sites-enabled/shop.conf', sha256: SHA_AFTER_HTTPS },
      modulesEnabled: [],
      dnsRecords: [
        { zoneId: 'zone-1', recordId: 'rec-1', name: 'shop.example.com', type: 'A' },
        { zoneId: 'zone-1', recordId: 'rec-2', name: 'www.shop.example.com', type: 'CNAME' }
      ],
      httpsSiteFile: null,
      certificate: { lineage: 'shop.example.com', issuedByRun: true },
      deploySite: 'shop'
    })
    expect(record.deployKey).toBe('ssh-ed25519 AAAAexample shellway')
    expect(ports.issue).toHaveBeenCalledWith({ blockId: 'shop.conf:1', names: ['shop.example.com', 'www.shop.example.com'], email: 'admin@example.com', redirect: true, staging: true }, ports.output)
    expect(calls.every((call) => call.command === ROOT_SHELL)).toBe(true)
    for (const call of calls) expect(output).toContain(call.stdin.trimEnd().split('\n').map((line) => `  ${line}`).join('\n'))
  })

  it('installs PHP and composer first, as root, with time for apt and downloads', async () => {
    const tools = allTools({ php: { installed: ['8.4'], installable: ['8.5'], missingPackages: { '8.4': [] } }, composer: false })
    ports.tools = vi.fn(async () => tools)
    const full = baseInput({ server: NGINX.server, phpVersion: '8.5' })
    const record = await new CreateSiteRun(newRunRecord('run-1', 'session-1', full, buildPlan(full, tools, NGINX.driver), 1), ports, NGINX.driver).run('start')
    expect(record.phase).toBe('done')
    expect(record.steps.map((step) => step.id).slice(0, 3)).toEqual(['php', 'composer', 'folder'])
    const execCalls = vi.mocked(ports.exec).mock.calls
    expect(execCalls[0][1]).toMatchObject({ timeoutMs: 900_000 })
    expect(String(execCalls[0][1]?.stdin)).toContain('install -y --no-remove php8.5-fpm')
    expect(String(execCalls[1][1]?.stdin)).toContain('getcomposer.org/installer')
  })

  it('stops at the PHP step when apt fails, before anything else is made', async () => {
    const tools = allTools({ php: { installed: [], installable: ['8.5'], missingPackages: {} } })
    ports.tools = vi.fn(async () => tools)
    ports.exec = vi.fn(async () => failed('E: Unable to locate package php8.5-fpm'))
    const full = baseInput({ server: NGINX.server, phpVersion: '8.5' })
    const record = await new CreateSiteRun(newRunRecord('run-1', 'session-1', full, buildPlan(full, tools, NGINX.driver), 1), ports, NGINX.driver).run('start')
    expect(record.phase).toBe('failed')
    expect(statuses(record).php).toBe('failed')
    expect(record.error).toBe('E: Unable to locate package php8.5-fpm')
    expect(record.created.folder).toBeNull()
  })

  it('stops instead of changing a certificate that was already on the server', async () => {
    certificateOnServer = true
    const record = await startRun(NGINX).run('start')
    expect(statuses(record).https).toBe('failed')
    expect(record.error).toContain('A certificate named shop.example.com is already on this server')
    expect(record.created.certificate).toBeNull()
    expect(ports.issue).not.toHaveBeenCalled()
  })

  it('does not add HTTPS to a site file this run did not create', async () => {
    failAt = 'site'
    const run = startRun(NGINX)
    await run.run('start')
    failAt = 'none'
    const record = await run.run('continue')
    expect(statuses(record).https).toBe('failed')
    expect(record.error).toContain('did not create the site file')
    expect(ports.issue).not.toHaveBeenCalled()
  })

  it('does not add HTTPS when the site file changed after it was written', async () => {
    const run = startRun(NGINX)
    const exec = ports.exec
    let reads = 0
    ports.exec = vi.fn(async (command, options) => {
      if (typeof options?.stdin === 'string' && options.stdin.includes('sha256sum') && ++reads === 2) return ok(`${'c'.repeat(64)}  file\n`)
      return exec(command, options)
    })
    const record = await run.run('start')
    expect(statuses(record).https).toBe('failed')
    expect(record.error).toContain('changed after Shellway wrote it')
    expect(ports.issue).not.toHaveBeenCalled()
  })

  it('keeps the site file in the record when the server gives no exit code', async () => {
    const run = startRun(NGINX)
    const exec = ports.exec
    ports.exec = vi.fn(async (command, options) => {
      if (typeof options?.stdin === 'string' && options.stdin.includes('undo_site')) return { code: undefined as unknown as number, stdout: '', stderr: '', stdoutBytes: 0 }
      return exec(command, options)
    })
    const record = await run.run('start')
    expect(statuses(record).site).toBe('failed')
    expect(record.created.siteFile).not.toBeNull()
  })

  it('does not ask for the certificate again when retrying after it was issued', async () => {
    const run = startRun(NGINX)
    const exec = ports.exec
    let failChecksum = true
    ports.exec = vi.fn(async (command, options) => {
      const stdin = typeof options?.stdin === 'string' ? options.stdin : ''
      if (httpsDone && failChecksum && stdin.includes('sha256sum')) return failed('connection reset')
      return exec(command, options)
    })
    const first = await run.run('start')
    expect(statuses(first).https).toBe('failed')
    expect(first.created.certificate).toEqual({ lineage: 'shop.example.com', issuedByRun: true })
    failChecksum = false
    const second = await run.run('retry')
    expect(second.phase).toBe('done')
    expect(ports.issue).toHaveBeenCalledTimes(1)
  })

  it('keeps the site file in the record when the connection drops while it is written', async () => {
    const run = startRun(NGINX)
    const exec = ports.exec
    ports.exec = vi.fn(async (command, options) => {
      if (typeof options?.stdin === 'string' && options.stdin.includes('undo_site')) throw new Error('Connection lost')
      return exec(command, options)
    })
    const record = await run.run('start')
    expect(statuses(record).site).toBe('failed')
    expect(record.created.siteFile).toMatchObject({ path: '/etc/nginx/sites-available/shop.conf', enabledLink: '/etc/nginx/sites-enabled/shop.conf' })
    expect(record.created.siteFile?.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('drops the site file from the record when the script refused or undid itself', async () => {
    failAt = 'site'
    const record = await startRun(NGINX).run('start')
    expect(record.created.siteFile).toBeNull()
  })

  it('keeps a DNS record this run already created instead of refusing it on retry', async () => {
    ports.dns!.find = vi.fn(async (_zone: string, name: string) =>
      name === 'shop.example.com' ? [{ id: 'made-before', type: 'A', name, content: '203.0.113.10', proxied: false, comment: dnsComment('run-1') }] : []
    )
    const record = await startRun(NGINX).run('start')
    expect(record.phase).toBe('done')
    expect(record.created.dnsRecords[0]).toEqual({ zoneId: 'zone-1', recordId: 'made-before', name: 'shop.example.com', type: 'A' })
    expect(ports.dns!.create).toHaveBeenCalledTimes(1)
  })

  it('records the Deploy site when saving failed after the site was written', async () => {
    failAt = 'deploys'
    let names: string[] = []
    ports.deploy.siteNames = vi.fn(async () => names)
    ports.deploy.save = vi.fn(async () => {
      names = ['shop']
      throw new Error('Site saved, but the auto-deploy schedule could not be updated')
    })
    const record = await startRun(NGINX).run('start')
    expect(statuses(record).deploys).toBe('failed')
    expect(record.created.deploySite).toBe('shop')
  })

  it.each<PlanActionId>(['folder', 'site', 'dns', 'https', 'deploys', 'first-deploy'])('stops at a failing %s step, keeps what was done, and runs nothing after it', async (step) => {
    failAt = step
    const record = await startRun(NGINX).run('start')
    expect(record.phase).toBe('failed')
    expect(record.error).not.toBeNull()
    const order = record.steps.map((s) => s.id)
    const at = order.indexOf(step)
    expect(record.steps.slice(0, at).every((s) => s.status === 'done')).toBe(true)
    expect(record.steps[at].status).toBe('failed')
    expect(record.steps.slice(at + 1).every((s) => s.status === 'pending')).toBe(true)
    if (at < order.indexOf('https')) expect(ports.issue).not.toHaveBeenCalled()
    if (at < order.indexOf('first-deploy')) expect(ports.deploy.deployAndWait).not.toHaveBeenCalled()
  })

  it('keeps the folder in the record when its script failed after creating it', async () => {
    const run = startRun(NGINX)
    ports.exec = vi.fn(async () => ({ code: 1, stdout: `${FOLDER_CREATED}\n`, stderr: 'chown: invalid user', stdoutBytes: 0 }))
    const record = await run.run('start')
    expect(record.created.folder).toEqual({ path: '/var/www/shop', createdByRun: true })
    expect(record.error).toBe('chown: invalid user')
  })

  it('retries only the failed step, then carries on', async () => {
    failAt = 'https'
    const run = startRun(NGINX)
    await run.run('start')
    failAt = 'none'
    const before = calls.length
    const record = await run.run('retry')
    expect(record.phase).toBe('done')
    expect(calls.slice(before).some((call) => call.stdin.includes(FOLDER_CREATED))).toBe(false)
    expect(ports.dns?.create).toHaveBeenCalledTimes(2)
  })

  it('continues from a failed step by marking it done by hand', async () => {
    failAt = 'dns'
    const run = startRun(NGINX)
    await run.run('start')
    failAt = 'none'
    const record = await run.run('continue')
    expect(statuses(record).dns).toBe('skipped')
    expect(record.phase).toBe('done')
    expect(record.created.dnsRecords).toEqual([])
  })

  it('stops after the running step when asked', async () => {
    const run = startRun(NGINX)
    ports.deploy.save = vi.fn(async () => { run.requestStop() })
    const record = await run.run('start')
    expect(record.phase).toBe('stopped')
    expect(statuses(record).deploys).toBe('done')
    expect(statuses(record)['first-deploy']).toBe('pending')
  })

  it('refuses to create a DNS record for a name that already has one', async () => {
    ports.dns!.find = vi.fn(async () => [{ id: 'theirs', type: 'A', name: 'shop.example.com', content: '198.51.100.7', proxied: false, comment: 'Created by Shellway Create site another-run' }])
    const record = await startRun(NGINX).run('start')
    expect(record.error).toBe('shop.example.com already has a DNS record (A 198.51.100.7). Nothing was changed in Cloudflare.')
    expect(ports.dns!.create).not.toHaveBeenCalled()
  })

  it('refuses to overwrite a Deploy site with the same name', async () => {
    ports.deploy.siteNames = vi.fn(async () => ['shop'])
    const record = await startRun(NGINX).run('start')
    expect(record.error).toBe('A Deploy site named shop already exists. Nothing was changed.')
    expect(ports.deploy.save).not.toHaveBeenCalled()
    expect(record.created.deploySite).toBeNull()
  })

  it('asks for the deploy key before the first deploy when the server cannot read the repository', async () => {
    ports.deploy.repoError = vi.fn(async () => 'Permission denied (publickey)')
    const record = await startRun(NGINX).run('start')
    expect(statuses(record)['first-deploy']).toBe('failed')
    expect(record.error).toContain('Add the deploy key to the repository, then Retry')
    expect(ports.deploy.deployAndWait).not.toHaveBeenCalled()
  })

  it('checks a hand-made DNS record by looking the names up', async () => {
    ports.resolves = vi.fn(async (name: string) => name === 'shop.example.com')
    const record = await startRun(NGINX, { dns: { zoneId: null, zoneName: null, serverIp: '203.0.113.10', proxied: false } }).run('start')
    expect(statuses(record).dns).toBe('failed')
    expect(record.error).toContain('www.shop.example.com does not point at 203.0.113.10 yet')
  })

  it('on Apache enables the missing modules and records the HTTPS file certbot added', async () => {
    const record = await startRun(APACHE_DEBIAN).run('start')
    expect(record.phase).toBe('done')
    expect(record.created.modulesEnabled).toEqual(['rewrite', 'proxy_fcgi', 'setenvif'])
    expect(record.created.httpsSiteFile).toEqual({ path: '/etc/apache2/sites-available/shop-le-ssl.conf', sha256: SHA_AFTER_HTTPS })
  })

  it('saves the record after every change so it survives a restart', async () => {
    await startRun(NGINX).run('start')
    expect(saved.length).toBeGreaterThan(10)
    expect(saved[saved.length - 1].phase).toBe('done')
  })
})

describe('removeCreated', () => {
  it('removes everything the run created, in order, and clears it from the record', async () => {
    const created = await startRun(APACHE_DEBIAN).run('start')
    calls = []
    const record = await removeCreated(created, ports, APACHE_DEBIAN.driver)
    expect(record.phase).toBe('removed')
    expect(record.created).toMatchObject({ folder: null, siteFile: null, httpsSiteFile: null, dnsRecords: [], certificate: null, deploySite: null })
    expect(ports.deploy.remove).toHaveBeenCalledWith('shop')
    expect(ports.dns!.remove).toHaveBeenNthCalledWith(1, 'zone-1', 'rec-1')
    expect(calls.map((call) => call.command)).toEqual([ROOT_SHELL, ROOT_SHELL, ROOT_SHELL, ROOT_SHELL])
    expect(calls[2].stdin).toContain("certbot delete --non-interactive --cert-name 'shop.example.com'")
    expect(calls[0].stdin).toContain("a2dissite 'shop-le-ssl'")
  })

  it('stops at the first removal that fails, keeps the rest in the record, and picks up from there next time', async () => {
    const created = await startRun(NGINX).run('start')
    ports.dns!.remove = vi.fn(async () => { throw new Error('Cloudflare said no') })
    ports.dns!.find = vi.fn(async (_zone: string, name: string) => [{ id: 'rec-1', type: 'A', name, content: '203.0.113.10', proxied: true, comment: '' }])
    const first = await removeCreated(created, ports, NGINX.driver)
    expect(first.phase).toBe('remove-failed')
    expect(first.error).toBe('DNS record A shop.example.com was not removed: Cloudflare said no')
    expect(first.created.deploySite).toBeNull()
    expect(first.created.siteFile).not.toBeNull()
    ports.dns!.remove = vi.fn(async () => {})
    const second = await removeCreated(first, ports, NGINX.driver)
    expect(second.phase).toBe('removed')
    expect(ports.deploy.remove).toHaveBeenCalledTimes(1)
  })

  it('treats a DNS record or Deploy site that is already gone as removed', async () => {
    const created = await startRun(NGINX).run('start')
    ports.dns!.remove = vi.fn(async () => { throw new Error('Record does not exist') })
    ports.deploy.remove = vi.fn(async () => { throw new Error('No such site') })
    const record = await removeCreated(created, ports, NGINX.driver)
    expect(record.phase).toBe('removed')
    expect(output).toContain('is already gone')
  })

  it('leaves alone what the run did not create', async () => {
    failAt = 'folder'
    const created = await startRun(NGINX).run('start')
    calls = []
    const record = await removeCreated(created, ports, NGINX.driver)
    expect(record.phase).toBe('removed')
    expect(calls).toEqual([])
    expect(ports.deploy.remove).not.toHaveBeenCalled()
    expect(ports.dns!.remove).not.toHaveBeenCalled()
  })
})
