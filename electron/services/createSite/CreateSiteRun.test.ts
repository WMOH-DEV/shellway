import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateSiteSecrets, CreateSiteInput, PlanActionId, RunRecord } from '../../../src/types/createSite'
import { DATABASE_CHECKED } from '../../../src/utils/createSite/database'
import { privateEnvFileScript } from '../../../src/utils/createSite/env'
import { buildPlan } from '../../../src/utils/createSite/plan'
import { FOLDER_CREATED, PROJECT_SHELL, ROOT_SHELL } from '../../../src/utils/createSite/siteScripts'
import { APACHE_DEBIAN, NGINX, allTools, baseInput, type ServerCase } from '../../../src/utils/createSite/testFixtures'
import type { ExecOptions } from '../../utils/sshExec'
import { CreateSiteRun, dnsComment, newRunRecord } from './CreateSiteRun'
import type { DnsRecord } from '../ssl/CloudflareClient'
import type { CreateSitePorts } from './ports'
import { deleteSite, removeCreated } from './removeRun'

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
let dnsRecords: DnsRecord[]
let ports: CreateSitePorts

const ok = (stdout = '') => ({ code: 0, stdout, stderr: '', stdoutBytes: stdout.length })
const failed = (stderr: string) => ({ code: 3, stdout: '', stderr, stdoutBytes: 0 })

function answer(command: string, stdin: string) {
  if (command !== ROOT_SHELL) return ok()
  if (stdin.includes('/etc/letsencrypt/renewal/')) return ok(certificateOnServer ? 'shellway: certificate exists\n' : '')
  if (stdin.includes('sha256sum')) return stdin.includes('-le-ssl') && !httpsDone ? ok('shellway: not there\n') : ok(`${httpsDone ? SHA_AFTER_HTTPS : SHA}  file\n`)
  if (stdin.includes(FOLDER_CREATED)) return failAt === 'folder' ? failed('/var/www/shop already exists. Nothing was changed.') : ok(`${FOLDER_CREATED}\n`)
  if (stdin.includes('/etc/cron.d/')) return failAt === 'jobs' ? failed('/etc/cron.d/shellway-shop already exists. Nothing was changed.') : ok()
  if (stdin.includes('CREATE DATABASE')) return failAt === 'database' ? failed('A database or user named shop already exists. Nothing was changed.') : ok(`${DATABASE_CHECKED}\n`)
  if (stdin.includes('pool.d')) return failAt === 'pool' ? failed('PHP-FPM rejected the new pool. It was removed.') : ok()
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
      find: vi.fn(async (_zone: string, name: string) => dnsRecords.filter((record) => record.name === name)),
      create: vi.fn(async (_zone, record) => {
        if (failAt === 'dns') throw new Error('Cloudflare refused the record')
        dnsCreated += 1
        const made = { id: `rec-${dnsCreated}`, type: record.type, name: record.name, content: record.content, proxied: record.proxied, comment: record.comment }
        dnsRecords.push(made)
        return made
      }),
      remove: vi.fn(async (_zone: string, id: string) => { dnsRecords = dnsRecords.filter((record) => record.id !== id) })
    },
    deploy: {
      ensureRunner: vi.fn(async () => {}),
      siteNames: vi.fn(async () => []),
      save: vi.fn(async () => { if (failAt === 'deploys') throw new Error('Could not save the site') }),
      remove: vi.fn(async () => {}),
      keygen: vi.fn(async () => 'ssh-ed25519 AAAAexample shellway'),
      repoError: vi.fn(async () => null),
      writeEnv: vi.fn(async () => {}),
      deployAndWait: vi.fn(async () => ({ id: 'd1', status: failAt === 'first-deploy' ? 'failed' : 'success', trigger: 'manual', commit: 'abc', started: 1, finished: 2, warnings: 0, note: failAt === 'first-deploy' ? 'health check failed' : '', subject: '' }) as const)
    },
    project: {
      githubLogin: vi.fn(async () => 'acme'),
      githubRepoExists: vi.fn(async () => false),
      createGithubRepo: vi.fn(async () => ({ sshUrl: 'git@github.com:acme/shop.git', httpsUrl: 'https://github.com/acme/shop.git' })),
      registerDeployKey: vi.fn(async () => {}),
      remoteHeads: vi.fn(async (): Promise<string[]> => []),
      makeFolder: vi.fn(async () => {}),
      removeFolder: vi.fn(async () => {}),
      writeFiles: vi.fn(async () => {}),
      extractArchive: vi.fn(async () => {}),
      readFile: vi.fn(async (): Promise<string | null> => null),
      commit: vi.fn(async () => 'abc123'),
      push: vi.fn(async () => {})
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
  return new CreateSiteRun(newRunRecord('run-1', 'session-1', full, plan, 1_800_000_000_000), ports, c.driver, SECRETS)
}

const PASSWORD = 'Pw7kQ2mZx9RtLb4NcV8sHj3D'
const APP_KEY = `base64:${'A'.repeat(42)}Q=`
const SECRETS: CreateSiteSecrets = { dbPassword: PASSWORD, appKey: APP_KEY, envText: 'MAIL_MAILER=smtp\n' }

const statuses = (record: RunRecord) => Object.fromEntries(record.steps.map((step) => [step.id, step.status]))

beforeEach(() => {
  calls = []
  failAt = 'none'
  httpsDone = false
  certificateOnServer = false
  saved = []
  output = ''
  dnsCreated = 0
  dnsRecords = []
  ports = makePorts()
})

describe('CreateSiteRun', () => {
  it('runs every action once, in order, and records what it created', async () => {
    const record = await startRun(NGINX).run('start')
    expect(record.phase).toBe('done')
    expect(Object.keys(statuses(record))).toEqual(['folder', 'pool', 'site', 'database', 'dns', 'https', 'deploys', 'env', 'first-deploy'])
    expect(Object.values(statuses(record)).every((status) => status === 'done')).toBe(true)
    expect(record.created).toEqual({
      folder: { path: '/var/www/shop', createdByRun: true },
      siteFile: { path: '/etc/nginx/sites-available/shop.conf', enabledLink: '/etc/nginx/sites-enabled/shop.conf', sha256: SHA_AFTER_HTTPS },
      phpPool: { path: '/etc/php/8.3/fpm/pool.d/shop.conf', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      database: { engine: 'mysql', name: 'shop', user: 'shop' },
      envFile: { path: '/var/www/shop-deploy/shared/.env', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      jobs: null,
      modulesEnabled: [],
      dnsRecords: [
        { zoneId: 'zone-1', recordId: 'rec-1', name: 'shop.example.com', type: 'A' },
        { zoneId: 'zone-1', recordId: 'rec-2', name: 'www.shop.example.com', type: 'CNAME' }
      ],
      httpsSiteFile: null,
      certificate: { lineage: 'shop.example.com', issuedByRun: true },
      deploySite: 'shop',
      repo: null,
      localCopy: null
    })
    expect(record.deployKey).toBe('ssh-ed25519 AAAAexample shellway')
    expect(ports.issue).toHaveBeenCalledWith({ blockId: 'shop.conf:1', names: ['shop.example.com', 'www.shop.example.com'], email: 'admin@example.com', redirect: true, staging: true }, expect.any(Function))
    expect(calls.filter((call) => call.command !== ROOT_SHELL)).toEqual([{ command: PROJECT_SHELL, stdin: privateEnvFileScript('/var/www/shop') }])
    for (const call of calls.filter((made) => !made.stdin.includes('CREATE USER'))) expect(output).toContain(call.stdin.trimEnd().split('\n').map((line) => `  ${line}`).join('\n'))
  })

  it('creates the database with the real password but never shows it in the output', async () => {
    await startRun(NGINX).run('start')
    const database = calls.find((call) => call.stdin.includes('CREATE USER'))
    expect(database?.stdin).toContain(`IDENTIFIED BY '${PASSWORD}'`)
    expect(output).toContain("IDENTIFIED BY '••••'")
    expect(output).not.toContain(PASSWORD)
    expect(output).not.toContain(APP_KEY)
  })

  it('writes the env file with the values Shellway manages on top of the user settings', async () => {
    await startRun(NGINX).run('start')
    const [name, content] = vi.mocked(ports.deploy.writeEnv).mock.calls[0]
    expect(name).toBe('shop')
    expect(content).toContain('MAIL_MAILER=smtp\n')
    expect(content).toContain(`APP_KEY=${APP_KEY}\n`)
    expect(content).toContain('APP_URL=https://shop.example.com\n')
    expect(content).toContain('DB_HOST=localhost\n')
    expect(content).toContain(`DB_PASSWORD=${PASSWORD}\n`)
  })

  it('makes the env file readable only by the site user before writing secrets into it', async () => {
    await startRun(NGINX).run('start')
    expect(privateEnvFileScript('/var/www/shop')).toBe("set -e\n[ -e '/var/www/shop-deploy/shared/.env' ] || (umask 077 && : > '/var/www/shop-deploy/shared/.env')\nchmod 600 '/var/www/shop-deploy/shared/.env'\n")
    const privateAt = calls.findIndex((call) => call.command === PROJECT_SHELL)
    expect(privateAt).toBeGreaterThan(-1)
    expect(vi.mocked(ports.deploy.writeEnv)).toHaveBeenCalledTimes(1)
  })

  it('records the database only once the server said its name is free', async () => {
    failAt = 'database'
    const record = await startRun(NGINX).run('start')
    expect(record.created.database).toBeNull()
    ports.exec = vi.fn(async () => { throw new Error('Connection lost') })
    const retried = await startRun(NGINX).run('start')
    expect(retried.created.database).toBeNull()
  })

  it('will not write the env file or deploy into a folder this run did not create', async () => {
    failAt = 'folder'
    const run = startRun(NGINX)
    await run.run('start')
    const record = await run.run('continue')
    expect(record.phase).toBe('failed')
    expect(record.error).toContain('This run did not create /var/www/shop')
    expect(ports.deploy.writeEnv).not.toHaveBeenCalled()
    expect(ports.deploy.save).not.toHaveBeenCalled()
  })

  it('refuses to create the database when the generated password is no longer known', async () => {
    const full = baseInput({ server: NGINX.server })
    const plan = buildPlan(full, allTools({ apacheModules: ['proxy', 'proxy_http', 'headers', 'ssl'] }), NGINX.driver)
    const record = await new CreateSiteRun(newRunRecord('run-1', 'session-1', full, plan, 1), ports, NGINX.driver, null).run('start')
    expect(record.phase).toBe('failed')
    expect(statuses(record).database).toBe('failed')
    expect(record.error).toContain('no longer known')
    expect(record.created.database).toBeNull()
  })

  it('installs PHP and composer first, as root, with time for apt and downloads', async () => {
    const tools = allTools({ php: { installed: ['8.4'], installable: ['8.5'], missingPackages: { '8.4': [] }, drivers: {} }, composer: false })
    ports.tools = vi.fn(async () => tools)
    const full = baseInput({ server: NGINX.server, phpVersion: '8.5' })
    const record = await new CreateSiteRun(newRunRecord('run-1', 'session-1', full, buildPlan(full, tools, NGINX.driver), 1), ports, NGINX.driver, SECRETS).run('start')
    expect(record.phase).toBe('done')
    expect(record.steps.map((step) => step.id).slice(0, 3)).toEqual(['php', 'composer', 'folder'])
    const execCalls = vi.mocked(ports.exec).mock.calls
    expect(execCalls[0][1]).toMatchObject({ timeoutMs: 900_000 })
    expect(String(execCalls[0][1]?.stdin)).toContain('install -y --no-remove php8.5-fpm')
    expect(String(execCalls[1][1]?.stdin)).toContain('getcomposer.org/installer')
  })

  it('stops at the PHP step when apt fails, before anything else is made', async () => {
    const tools = allTools({ php: { installed: [], installable: ['8.5'], missingPackages: {}, drivers: {} } })
    ports.tools = vi.fn(async () => tools)
    ports.exec = vi.fn(async () => failed('E: Unable to locate package php8.5-fpm'))
    const full = baseInput({ server: NGINX.server, phpVersion: '8.5' })
    const record = await new CreateSiteRun(newRunRecord('run-1', 'session-1', full, buildPlan(full, tools, NGINX.driver), 1), ports, NGINX.driver, SECRETS).run('start')
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

  it.each<PlanActionId>(['folder', 'pool', 'site', 'database', 'dns', 'https', 'deploys', 'first-deploy'])('stops at a failing %s step, keeps what was done, and runs nothing after it', async (step) => {
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

  it('sets up the Laravel scheduler and queue worker last and records both files', async () => {
    const record = await startRun(NGINX, { jobs: { scheduler: true, queueWorker: true } }).run('start')
    expect(record.phase).toBe('done')
    expect(record.steps.at(-1)).toMatchObject({ id: 'jobs', status: 'done' })
    expect(record.created.jobs).toEqual({ cronFile: '/etc/cron.d/shellway-shop', unitFile: '/etc/systemd/system/shellway-shop-queue.service' })
    expect(calls.at(-1)?.stdin).toContain("systemctl enable --now 'shellway-shop-queue.service'")
  })

  it('forgets the job files when the server already had other ones', async () => {
    failAt = 'jobs'
    const record = await startRun(NGINX, { jobs: { scheduler: true, queueWorker: false } }).run('start')
    expect(record.phase).toBe('failed')
    expect(record.created.jobs).toBeNull()
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

  it('keeps a record that already points at this server and never counts it as made by the run', async () => {
    ports.dns!.find = vi.fn(async (_zone: string, name: string) => name === 'shop.example.com' ? [{ id: 'theirs', type: 'A', name, content: '203.0.113.10', proxied: true, comment: '' }] : [])
    const record = await startRun(NGINX).run('start')
    expect(record.phase).toBe('done')
    expect(ports.dns!.create).toHaveBeenCalledTimes(1)
    expect(record.created.dnsRecords.map((made) => made.name)).toEqual(['www.shop.example.com'])
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

  it('records the PHP pool before writing it and forgets it when PHP-FPM refuses it', async () => {
    failAt = 'pool'
    const record = await startRun(NGINX).run('start')
    expect(record.phase).toBe('failed')
    expect(record.created.phpPool).toBeNull()
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

const LARAVEL_PROJECT: Partial<CreateSiteInput> = {
  codeSource: 'new',
  newRepo: { kind: 'github', owner: 'acme', name: 'shop', private: true },
  localParent: '/home/dev/Projects'
}

const GITHUB_PROJECT: Partial<CreateSiteInput> = { ...LARAVEL_PROJECT, template: 'node', database: null }

const EMPTY_REPO_PROJECT: Partial<CreateSiteInput> = { ...GITHUB_PROJECT, newRepo: { kind: 'empty' } }

describe('CreateSiteRun with a new project', () => {
  it('creates the GitHub repository, writes and pushes the project, then adds the deploy key itself', async () => {
    const record = await startRun(NGINX, GITHUB_PROJECT).run('start')
    expect(record.phase).toBe('done')
    expect(record.steps.slice(0, 2).map((step) => step.id)).toEqual(['repo', 'scaffold'])
    expect(ports.project.createGithubRepo).toHaveBeenCalledWith('shop', true)
    expect(ports.project.makeFolder).toHaveBeenCalledWith('/home/dev/Projects/shop')
    expect(ports.project.writeFiles).toHaveBeenCalledWith('/home/dev/Projects/shop', expect.objectContaining({ 'package.json': expect.any(String) }))
    expect(ports.project.commit).toHaveBeenCalledWith('/home/dev/Projects/shop', 'main', 'Start shop')
    expect(ports.project.push).toHaveBeenCalledWith('/home/dev/Projects/shop', 'git@github.com:acme/shop.git', 'main')
    expect(ports.project.registerDeployKey).toHaveBeenCalledWith('acme', 'shop', 'Shellway deploy: shop', 'ssh-ed25519 AAAAexample shellway')
    expect(record.created.repo).toEqual({ url: 'git@github.com:acme/shop.git', createdByRun: true })
    expect(record.created.localCopy).toBe('/home/dev/Projects/shop')
    expect(record.deployKeyAdded).toBe(true)
  })

  it('uses a GitHub repository that already exists only when it is still empty', async () => {
    vi.mocked(ports.project.githubRepoExists).mockResolvedValue(true)
    const record = await startRun(NGINX, GITHUB_PROJECT).run('start')
    expect(ports.project.createGithubRepo).not.toHaveBeenCalled()
    expect(record.created.repo).toEqual({ url: 'git@github.com:acme/shop.git', createdByRun: false })
  })

  it('stops before writing anything when the repository has commits', async () => {
    vi.mocked(ports.project.remoteHeads).mockResolvedValue(['main'])
    const record = await startRun(NGINX, EMPTY_REPO_PROJECT).run('start')
    expect(record.phase).toBe('failed')
    expect(statuses(record).repo).toBe('failed')
    expect(record.error).toContain('has commits now')
    expect(ports.project.makeFolder).not.toHaveBeenCalled()
    expect(record.created.repo).toBeNull()
  })

  it('stops when GitHub made the repository under another account, keeping it in the record, and again on Retry', async () => {
    vi.mocked(ports.project.createGithubRepo).mockResolvedValue({ sshUrl: 'git@github.com:other/shop.git', httpsUrl: 'https://github.com/other/shop.git' })
    const run = startRun(NGINX, GITHUB_PROJECT)
    const record = await run.run('start')
    expect(record.phase).toBe('failed')
    expect(record.error).toContain('another account')
    expect(record.created.repo).toEqual({ url: 'git@github.com:other/shop.git', createdByRun: true })
    const retried = await run.run('retry')
    expect(retried.error).toContain('another account')
    expect(ports.project.createGithubRepo).toHaveBeenCalledTimes(1)
    expect(ports.project.push).not.toHaveBeenCalled()
  })

  it('removes the half-made folder on this PC when the commit fails, and records no local copy', async () => {
    vi.mocked(ports.project.commit).mockRejectedValue(new Error('git has no name and email set on this PC'))
    const record = await startRun(NGINX, GITHUB_PROJECT).run('start')
    expect(statuses(record).scaffold).toBe('failed')
    expect(ports.project.removeFolder).toHaveBeenCalledWith('/home/dev/Projects/shop')
    expect(record.created.localCopy).toBeNull()
    expect(ports.project.push).not.toHaveBeenCalled()
  })

  it('pushes over HTTPS when the SSH push to GitHub fails', async () => {
    vi.mocked(ports.project.push).mockRejectedValueOnce(new Error('Permission denied (publickey)'))
    const record = await startRun(NGINX, GITHUB_PROJECT).run('start')
    expect(record.phase).toBe('done')
    expect(vi.mocked(ports.project.push).mock.calls.map(([, url]) => url)).toEqual(['git@github.com:acme/shop.git', 'https://github.com/acme/shop.git'])
  })

  it('only pushes again on retry once the project was committed', async () => {
    vi.mocked(ports.project.push).mockRejectedValue(new Error('offline'))
    const run = startRun(NGINX, EMPTY_REPO_PROJECT)
    const failedRecord = await run.run('start')
    expect(failedRecord.error).toContain('Could not push the new project from this PC: offline')
    vi.mocked(ports.project.push).mockResolvedValue()
    const record = await run.run('retry')
    expect(record.phase).toBe('done')
    expect(ports.project.makeFolder).toHaveBeenCalledTimes(1)
    expect(ports.project.push).toHaveBeenCalledTimes(2)
  })

  it('carries on with a message when GitHub refuses the deploy key', async () => {
    vi.mocked(ports.project.registerDeployKey).mockRejectedValue(new Error('GitHub refused the deploy key'))
    const record = await startRun(NGINX, GITHUB_PROJECT).run('start')
    expect(record.phase).toBe('done')
    expect(record.deployKeyAdded).toBeUndefined()
    expect(output).toContain('Add the key below to the repository by hand')
  })

  it('makes a Laravel project on the server as the login user and builds the env file from its .env.example', async () => {
    vi.mocked(ports.project.readFile).mockResolvedValue('APP_NAME=Laravel\nBROADCAST_CONNECTION=log\n')
    const record = await startRun(NGINX, LARAVEL_PROJECT).run('start')
    expect(record.phase).toBe('done')
    expect(calls.find((call) => call.command === PROJECT_SHELL)?.stdin).toContain('create-project laravel/laravel')
    expect(ports.project.extractArchive).toHaveBeenCalledWith('/home/dev/Projects/shop', '')
    expect(ports.project.readFile).toHaveBeenCalledWith('/home/dev/Projects/shop', '.env.example')
    const [, content] = vi.mocked(ports.deploy.writeEnv).mock.calls[0]
    expect(content).toContain('BROADCAST_CONNECTION=log\n')
    expect(content).toContain(`DB_PASSWORD=${PASSWORD}\n`)
  })
})

describe('CreateSiteRun with no code yet', () => {
  it('makes a placeholder folder and the site, without a database or deploys', async () => {
    const record = await startRun(NGINX, { codeSource: 'none', template: 'static', database: null, buildSteps: [], activateSteps: [], env: false }).run('start')
    expect(record.phase).toBe('done')
    expect(Object.keys(statuses(record))).toEqual(['folder', 'site', 'dns', 'https'])
    expect(record.created.folder).toEqual({ path: '/var/www/shop', createdByRun: true, placeholderSha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(ports.deploy.save).not.toHaveBeenCalled()
  })
})

describe('removeCreated', () => {
  it('removes everything the run created, in order, and clears it from the record', async () => {
    const created = await startRun(APACHE_DEBIAN).run('start')
    calls = []
    const record = await removeCreated(created, ports, APACHE_DEBIAN.driver)
    expect(record.phase).toBe('removed')
    expect(record.created).toMatchObject({ folder: null, siteFile: null, phpPool: null, httpsSiteFile: null, dnsRecords: [], certificate: null, deploySite: null })
    expect(ports.deploy.remove).toHaveBeenCalledWith('shop')
    expect(ports.dns!.remove).toHaveBeenNthCalledWith(1, 'zone-1', 'rec-1')
    expect(calls.map((call) => call.command)).toEqual(Array(7).fill(ROOT_SHELL))
    expect(calls[2].stdin).toContain("rm -f '/etc/php/8.3/fpm/pool.d/shop.conf'")
    expect(calls[3].stdin).toContain("certbot delete --non-interactive --cert-name 'shop.example.com'")
    expect(calls[4].stdin).toContain("rm -f '/var/www/shop-deploy/shared/.env'")
    expect(calls[5].stdin).toContain('DROP DATABASE IF EXISTS `shop`;')
    expect(record.created).toMatchObject({ database: null, envFile: null })
    expect(calls[0].stdin).toContain("a2dissite 'shop-le-ssl'")
  })

  it('stops the queue worker and removes the cron file first', async () => {
    const created = await startRun(NGINX, { jobs: { scheduler: true, queueWorker: true } }).run('start')
    calls = []
    const record = await removeCreated(created, ports, NGINX.driver)
    expect(record.phase).toBe('removed')
    expect(record.created.jobs).toBeNull()
    expect(calls[0].stdin).toContain("systemctl disable --now 'shellway-shop-queue.service'")
    expect(calls[0].stdin).toContain("rm -f '/etc/cron.d/shellway-shop'")
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
    dnsRecords = []
    ports.deploy.remove = vi.fn(async () => { throw new Error('No such site') })
    const record = await removeCreated(created, ports, NGINX.driver)
    expect(record.phase).toBe('removed')
    expect(output).toContain('The DNS record for shop.example.com is already gone')
    expect(output).toContain('Deploy site shop is already gone')
    expect(ports.dns!.remove).not.toHaveBeenCalled()
  })

  it('treats a DNS record that disappears while it is being deleted as removed', async () => {
    const created = await startRun(NGINX).run('start')
    ports.dns!.remove = vi.fn(async (_zone: string, id: string) => {
      dnsRecords = dnsRecords.filter((record) => record.id !== id)
      throw new Error('Record does not exist')
    })
    expect((await removeCreated(created, ports, NGINX.driver)).phase).toBe('removed')
  })

  it('stops instead of deleting a DNS record that now points somewhere else', async () => {
    const created = await startRun(NGINX).run('start')
    dnsRecords = dnsRecords.map((record) => (record.type === 'A' ? { ...record, content: '198.51.100.7' } : record))
    const record = await removeCreated(created, ports, NGINX.driver)
    expect(record.phase).toBe('remove-failed')
    expect(record.error).toBe('DNS record A shop.example.com was not removed: The DNS record A shop.example.com now points at 198.51.100.7, not 203.0.113.10. It was left in place.')
    expect(ports.dns!.remove).not.toHaveBeenCalled()
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

describe('deleteSite', () => {
  const LEFT = `It was left in place.`

  function refuseWhen(match: string, code: number, stderr: string): void {
    const exec = ports.exec
    ports.exec = vi.fn(async (command: string, options: ExecOptions = {}) => {
      const stdin = typeof options.stdin === 'string' ? options.stdin : ''
      if (stdin.includes(match)) {
        calls.push({ command, stdin })
        return { code, stdout: '', stderr, stdoutBytes: 0 }
      }
      return exec(command, options)
    })
  }

  it('removes what makes the site run and keeps the folder, database and env file', async () => {
    const created = await startRun(NGINX, { jobs: { scheduler: true, queueWorker: true } }).run('start')
    calls = []
    const record = await deleteSite(created, ports, NGINX.driver)
    expect(record).toMatchObject({ phase: 'removed', deleting: true })
    expect(record.created).toMatchObject({ deploySite: null, jobs: null, dnsRecords: [], siteFile: null, phpPool: null, certificate: null })
    expect(record.created.folder).toEqual(created.created.folder)
    expect(record.created.database).toEqual(created.created.database)
    expect(record.created.envFile).toEqual(created.created.envFile)
    const scripts = calls.map((call) => call.stdin).join('\n')
    expect(scripts).not.toMatch(/DROP DATABASE|rm -rf|shop-deploy|shared\/\.env/)
    expect(ports.deploy.remove).toHaveBeenCalledWith('shop')
    expect(dnsRecords).toEqual([])
  })

  it('keeps a site file changed by hand with the PHP pool and certificate it uses, and removes the rest', async () => {
    const created = await startRun(NGINX).run('start')
    calls = []
    refuseWhen('keep=$(mktemp -d)', 3, `/etc/nginx/sites-available/shop.conf changed after Shellway wrote it. ${LEFT}`)
    refuseWhen('certbot delete', 3, `The certificate shop.example.com is still used by /etc/nginx/sites-available/shop.conf . ${LEFT}`)
    const record = await deleteSite(created, ports, NGINX.driver)
    expect(record.phase).toBe('removed')
    expect(record.kept).toEqual([
      `/etc/nginx/sites-available/shop.conf changed after Shellway wrote it. ${LEFT}`,
      `/etc/php/8.3/fpm/pool.d/shop.conf is used by the site file that was kept. ${LEFT}`,
      `The certificate shop.example.com is still used by /etc/nginx/sites-available/shop.conf . ${LEFT}`
    ])
    expect(record.kept?.[1]).toBe(`/etc/php/8.3/fpm/pool.d/shop.conf is used by the site file that was kept. ${LEFT}`)
    expect(record.created).toMatchObject({ siteFile: null, phpPool: null, certificate: null })
    expect(calls.some((call) => call.stdin.includes("rm -f '/etc/php/8.3/fpm/pool.d/shop.conf'"))).toBe(false)
  })

  it('stops on a real failure and picks up from there without repeating what was done', async () => {
    const created = await startRun(NGINX).run('start')
    refuseWhen('keep=$(mktemp -d)', 4, 'nginx rejected the configuration without this site, so /etc/nginx/sites-available/shop.conf was put back.')
    const failed = await deleteSite(created, ports, NGINX.driver)
    expect(failed).toMatchObject({ phase: 'remove-failed', deleting: true })
    expect(failed.error).toContain('was put back')
    expect(failed.created.deploySite).toBeNull()
    expect(failed.created.siteFile).not.toBeNull()
    expect(failed.created.phpPool).not.toBeNull()
    ports = makePorts()
    const second = await deleteSite(failed, ports, NGINX.driver)
    expect(second.phase).toBe('removed')
    expect(ports.deploy.remove).not.toHaveBeenCalled()
  })

  it('still keeps the PHP pool on a retry after its site file was kept', async () => {
    const created = await startRun(APACHE_DEBIAN).run('start')
    refuseWhen("'shop-le-ssl'", 3, `/etc/apache2/sites-available/shop-le-ssl.conf changed after Shellway wrote it. ${LEFT}`)
    refuseWhen("'/etc/apache2/sites-available/shop.conf'", 4, 'Apache rejected the configuration without this site, so /etc/apache2/sites-available/shop.conf was put back.')
    const failed = await deleteSite(created, ports, APACHE_DEBIAN.driver)
    expect(failed).toMatchObject({ phase: 'remove-failed', siteFileKept: true })
    ports = makePorts()
    calls = []
    const second = await deleteSite(failed, ports, APACHE_DEBIAN.driver)
    expect(second.phase).toBe('removed')
    expect(second.kept).toContain(`/etc/php/8.3/fpm/pool.d/shop.conf is used by the site file that was kept. ${LEFT}`)
    expect(calls.some((call) => call.stdin.includes("rm -f '/etc/php/8.3/fpm/pool.d/shop.conf'"))).toBe(false)
  })

  it('stops on a refusal that does not say it left the file in place', async () => {
    const created = await startRun(NGINX).run('start')
    refuseWhen('keep=$(mktemp -d)', 3, 'something else went wrong')
    expect((await deleteSite(created, ports, NGINX.driver)).phase).toBe('remove-failed')
  })

  it('keeps a DNS record that now points somewhere else and goes on', async () => {
    const created = await startRun(NGINX).run('start')
    dnsRecords = dnsRecords.map((record) => (record.type === 'A' ? { ...record, content: '198.51.100.7' } : record))
    const record = await deleteSite(created, ports, NGINX.driver)
    expect(record.phase).toBe('removed')
    expect(record.kept).toEqual(['The DNS record A shop.example.com now points at 198.51.100.7, not 203.0.113.10. It was left in place.'])
    expect(dnsRecords.map((r) => r.type)).toEqual(['A'])
  })

  it('stops a Node app under pm2 as the site user after removing its Deploy site', async () => {
    const created = await startRun(NGINX, { template: 'node', database: null }).run('start')
    calls = []
    const record = await deleteSite(created, ports, NGINX.driver)
    expect(record.phase).toBe('removed')
    const app = calls.find((call) => call.stdin.includes('pm2 delete'))
    expect(app).toMatchObject({ command: PROJECT_SHELL })
    expect(app?.stdin).toContain("pm2 delete 'shop'")
    expect(app?.stdin).toContain('pm2 save --force')
  })
})
