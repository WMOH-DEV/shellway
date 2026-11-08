import { isAbsolute, posix } from 'path'
import type { CloudflareZoneRef, CreateSiteContext, CreateSiteInput, NameCheck, ProjectCheckRequest, ResumeMode, RunRecord, SiteServer } from '../../../src/types/createSite'
import { NEW_PROJECT_TEMPLATES, NO_CODE_TEMPLATES, githubSshUrlOf } from '../../../src/utils/createSite/scaffold'
import type { ServerFacts } from '../../../src/types/ssl'
import { deploySiteConfig } from '../../../src/utils/createSite/deploySite'
import { needsDatabase, siteDatabase } from '../../../src/utils/createSite/database'
import { assertSecrets } from '../../../src/utils/createSite/env'
import { buildPlan } from '../../../src/utils/createSite/plan'
import { assertDomain } from '../../../src/utils/createSite/validate'
import { webServerDriver } from '../../../src/utils/webServer'
import type { WebServerDriver } from '../../../src/utils/webServer/driver'
import { siteServer } from '../../../src/utils/webServer/siteServer'
import type { DeployCoordinator } from '../deploy/DeployCoordinator'
import { RUNNER, type RemoteExec } from '../deploy/DeployService'
import { validateSiteConfig } from '../deploy/siteFiles'
import { resolveAddresses } from '../ssl/dnsEdge'
import type { SslCoordinator } from '../ssl/SslCoordinator'
import { CreateSiteRun, newRunRecord } from './CreateSiteRun'
import type { CreateSitePorts, DeployPort, DnsPort, ProjectPort } from './ports'
import { checkNewProject } from './projectPort'
import { removeCreated } from './removeRun'
import type { RunStore } from './RunStore'
import { TOOLS_SCRIPT, detectTools } from './serverTools'

export interface CreateSiteDeps {
  execFor: (connectionId: string) => RemoteExec | null
  project: ProjectPort
  sessionOf: (connectionId: string) => string | null
  ssl: SslCoordinator
  deploy: DeployCoordinator
  store: RunStore
  broadcast: (channel: string, ...args: unknown[]) => void
  newId: () => string
  now: () => number
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/
const FINISHED: ReadonlySet<RunRecord['phase']> = new Set(['done', 'removed'])
const ZONE_ID = /^[A-Za-z0-9]{1,64}$/
const CLOSED_MID_STEP = 'Shellway closed while this step was running. Check the server, then Retry or Continue from here.'
const CLOSED_MID_REMOVAL = 'Shellway closed while removing. Press Remove again to pick up from here.'

const sameServer = (a: SiteServer | null, b: SiteServer): boolean =>
  a !== null && a.kind === b.kind && (a.kind !== 'apache' || b.kind !== 'apache' || a.layout === b.layout)

function interrupted(record: RunRecord): RunRecord {
  if (record.phase === 'removing') return { ...record, phase: 'remove-failed', error: CLOSED_MID_REMOVAL }
  const steps = record.steps.map((step) => (step.id === record.current && step.status === 'pending' && step.startedAt !== null ? { ...step, status: 'failed' as const } : step))
  return { ...record, steps, phase: 'failed', error: CLOSED_MID_STEP }
}

function assertDatabaseMatches(input: CreateSiteInput): void {
  const { database } = input
  if (database === null && input.codeSource !== 'none' && needsDatabase(input.template)) throw new Error('Laravel needs a database for its migrations')
  if (database !== null && JSON.stringify(database) !== JSON.stringify(siteDatabase(database.engine, input))) throw new Error('Invalid database settings')
}

const GITHUB_NAME = /^[A-Za-z0-9._-]{1,100}$/

function assertNewProject(input: CreateSiteInput): void {
  const { newRepo, localParent } = input
  if (newRepo === null || localParent === null || !isAbsolute(localParent)) throw new Error('Invalid new project settings')
  if (!NEW_PROJECT_TEMPLATES.includes(input.template)) throw new Error(`${input.template} cannot start as a new project`)
  if (newRepo.kind === 'empty') return
  const valid = GITHUB_NAME.test(newRepo.owner) && GITHUB_NAME.test(newRepo.name) && typeof newRepo.private === 'boolean'
  if (!valid || input.repoUrl !== githubSshUrlOf(newRepo.owner, newRepo.name)) throw new Error('Invalid new repository settings')
}

function assertNoCode(input: CreateSiteInput): void {
  const quiet = input.database === null && !input.env && input.buildSteps.length === 0 && input.activateSteps.length === 0
  if (!NO_CODE_TEMPLATES.includes(input.template) || !quiet || input.newRepo !== null) throw new Error('Invalid settings for a site without code')
}

function assertCodeSource(input: CreateSiteInput): void {
  switch (input.codeSource) {
    case 'git':
      if (input.newRepo !== null || input.localParent !== null) throw new Error('Invalid code settings')
      return
    case 'new': return assertNewProject(input)
    case 'none': return assertNoCode(input)
    default: throw new Error('Invalid code source')
  }
}

function serverOf(facts: ServerFacts): SiteServer | null {
  const kind = siteServer(facts)
  if (kind === 'nginx') return { kind: 'nginx' }
  return kind === 'apache' ? { kind: 'apache', layout: facts.apache?.layout ?? 'debian' } : null
}

const driverFor = (server: SiteServer): WebServerDriver => webServerDriver(server.kind, server.kind === 'apache' ? server.layout : null)

const serverAddress = (facts: ServerFacts): string | null => facts.addresses.find((address) => IPV4.test(address) && !address.startsWith('127.')) ?? null

function zoneFor(domain: string, zones: CloudflareZoneRef[]): CloudflareZoneRef | null {
  const matching = zones.filter((zone) => domain === zone.name || domain.endsWith(`.${zone.name}`))
  return matching.sort((a, b) => b.name.length - a.name.length)[0] ?? null
}

export class CreateSiteService {
  private readonly active = new Map<string, CreateSiteRun>()
  private readonly removing = new Set<string>()
  private readonly busy = new Set<string>()

  constructor(private readonly deps: CreateSiteDeps) {}

  async context(connectionId: string): Promise<CreateSiteContext> {
    const exec = this.exec(connectionId)
    const { facts } = await this.deps.ssl.service(connectionId).readConfig()
    const [tools, cloudflare, deploySiteNames] = await Promise.all([detectTools(exec, facts), this.deps.ssl.cloudflareStatus(), this.deploySiteNames(connectionId)])
    const connected = cloudflare.saved && cloudflare.error === null
    return {
      server: serverOf(facts),
      tools,
      serverIp: serverAddress(facts),
      owner: facts.user,
      fullSudo: facts.sudo.full,
      zones: connected ? cloudflare.zones.map(({ id, name }) => ({ id, name })) : [],
      dnsEdit: connected && cloudflare.permissions.find((group) => group.id === 'dns-records')?.state !== 'missing',
      deploySiteNames
    }
  }

  async checkName(connectionId: string, domain: string): Promise<NameCheck> {
    const name = assertDomain(domain.toLowerCase())
    const names = [name, `www.${name}`]
    const [{ blocks }, cloudflare] = await Promise.all([this.deps.ssl.service(connectionId).readConfig(), this.deps.ssl.cloudflareStatus()])
    const zone = cloudflare.saved && cloudflare.error === null ? zoneFor(name, cloudflare.zones) : null
    const client = zone ? this.deps.ssl.dnsClient() : null
    const found = client && zone ? (await Promise.all(names.map((n) => client.findDnsRecords(zone.id, n)))).flat() : []
    const served = blocks.find((block) => block.names.some((n) => names.includes(n.toLowerCase())))
    return {
      zone: zone ? { id: zone.id, name: zone.name } : null,
      records: found.map(({ type, name: recordName, content }) => ({ type, name: recordName, content })),
      servedBy: served?.file ?? null
    }
  }

  githubAccount(): Promise<string | null> {
    return this.deps.project.githubLogin()
  }

  checkProject(request: ProjectCheckRequest): Promise<string | null> {
    return checkNewProject(this.deps.project, request)
  }

  start(connectionId: string, sessionId: string, input: CreateSiteInput, rawSecrets: unknown): Promise<RunRecord> {
    this.assertSameServer(connectionId, sessionId)
    return this.begin(connectionId, async () => {
      const secrets = assertSecrets(input, rawSecrets)
      assertDatabaseMatches(input)
      assertCodeSource(input)
      const ports = this.ports(connectionId, sessionId, this.deps.newId())
      const driver = driverFor(input.server)
      const invalid = input.codeSource === 'none' ? null : validateSiteConfig(deploySiteConfig(input))
      if (invalid) throw new Error(invalid)
      await this.checkAgainstServer(connectionId, input)
      const plan = buildPlan(input, await ports.tools(), driver)
      const record = newRunRecord(ports.runId, sessionId, input, plan, this.deps.now())
      this.deps.store.saveSecrets(record.id, secrets)
      ports.save(record)
      return new CreateSiteRun(record, ports, driver, secrets)
    }, 'start')
  }

  resume(connectionId: string, runId: string, mode: ResumeMode): Promise<RunRecord> {
    const record = this.stored(runId)
    if (record.phase !== 'failed' && record.phase !== 'stopped') throw new Error('This run is not waiting for you.')
    this.assertSameServer(connectionId, record.sessionId)
    return this.begin(connectionId, async () => new CreateSiteRun(record, this.ports(connectionId, record.sessionId, runId), driverFor(record.server), this.deps.store.secrets(runId)), mode)
  }

  stop(runId: string): void {
    this.active.get(runId)?.requestStop()
  }

  async remove(connectionId: string, runId: string): Promise<RunRecord> {
    const record = this.stored(runId)
    if (this.active.has(runId) || record.phase === 'running' || record.phase === 'removing') throw new Error('Stop the run before removing what it created.')
    this.assertSameServer(connectionId, record.sessionId)
    this.claim(connectionId)
    this.removing.add(runId)
    try {
      return await removeCreated(record, this.ports(connectionId, record.sessionId, runId), driverFor(record.server))
    } finally {
      this.removing.delete(runId)
      this.busy.delete(connectionId)
    }
  }

  runs(sessionId: string): RunRecord[] {
    return this.deps.store.forSession(sessionId).map((run) => this.settled(run)).filter((run) => !FINISHED.has(run.phase))
  }

  private settled(record: RunRecord): RunRecord {
    const inFlight = record.phase === 'running' || record.phase === 'removing'
    if (!inFlight || this.active.has(record.id) || this.removing.has(record.id)) return record
    const fixed = interrupted(record)
    this.deps.store.save(fixed)
    return fixed
  }

  private async checkAgainstServer(connectionId: string, input: CreateSiteInput): Promise<void> {
    const { facts } = await this.deps.ssl.service(connectionId).readConfig()
    if (!sameServer(serverOf(facts), input.server)) throw new Error('The web server on this server changed. Open Create site again.')
    if (facts.user !== input.owner) throw new Error(`The site owner must be the user Shellway is logged in as (${facts.user}).`)
    if (input.dns === null || input.dns.zoneId === null) return
    const { zoneId, zoneName } = input.dns
    if (!ZONE_ID.test(zoneId)) throw new Error('Invalid Cloudflare zone')
    const cloudflare = await this.deps.ssl.cloudflareStatus()
    const zone = cloudflare.zones.find((z) => z.id === zoneId)
    if (!zone || zone.name !== zoneName) throw new Error('That Cloudflare zone is not on the connected account.')
    if (zoneFor(assertDomain(input.domain), [zone]) === null) throw new Error(`${input.domain} is not in the ${zone.name} zone.`)
  }

  private async begin(connectionId: string, prepare: () => Promise<CreateSiteRun>, mode: 'start' | ResumeMode): Promise<RunRecord> {
    this.claim(connectionId)
    let run: CreateSiteRun
    try {
      run = await prepare()
    } catch (err) {
      this.busy.delete(connectionId)
      throw err
    }
    const runId = run.current.id
    this.active.set(runId, run)
    void run.run(mode).finally(() => {
      this.active.delete(runId)
      this.busy.delete(connectionId)
    })
    return run.current
  }

  private assertSameServer(connectionId: string, sessionId: string): void {
    if (this.deps.sessionOf(connectionId) !== sessionId) throw new Error('This run belongs to a different server connection.')
  }

  private claim(connectionId: string): void {
    if (this.busy.has(connectionId)) throw new Error('Create site is already busy on this server.')
    this.busy.add(connectionId)
  }

  private stored(runId: string): RunRecord {
    const record = this.deps.store.get(runId)
    if (!record) throw new Error('This Create site run is no longer known.')
    return this.settled(record)
  }

  private exec(connectionId: string): RemoteExec {
    const exec = this.deps.execFor(connectionId)
    if (!exec) throw new Error('Not connected')
    return exec
  }

  private async deploySiteNames(connectionId: string): Promise<string[]> {
    const service = this.deps.deploy.service(connectionId)
    if (!(await service.runnerInfo()).installed) return []
    return (await service.listSites()).map((site) => site.config.name)
  }

  private dnsPort(): DnsPort | null {
    const client = this.deps.ssl.dnsClient()
    if (!client) return null
    return {
      find: (zoneId, name) => client.findDnsRecords(zoneId, name),
      create: (zoneId, record) => client.createDnsRecord(zoneId, record),
      remove: (zoneId, recordId) => client.deleteDnsRecord(zoneId, recordId)
    }
  }

  private deployPort(connectionId: string, sessionId: string, say: (command: string) => void): DeployPort {
    const coordinator = this.deps.deploy
    const service = () => coordinator.service(connectionId)
    return {
      ensureRunner: async () => {
        say(`${RUNNER} version`)
        const runner = await service().runnerInfo()
        if (runner.version !== null && runner.version >= runner.bundledVersion) return
        say(`mkdir -p "$HOME/.shellway-deploy/bin" && cat > ${RUNNER}.tmp && chmod 755 ${RUNNER}.tmp && mv -f ${RUNNER}.tmp ${RUNNER}`)
        await service().installRunner()
      },
      siteNames: () => {
        say(`${RUNNER} dump`)
        return this.deploySiteNames(connectionId)
      },
      save: async (config) => {
        say(`write "$HOME/.shellway-deploy/sites/${config.name}/" site.conf, steps.build and steps.activate, then ${RUNNER} sync-cron`)
        await service().saveSite(config)
        await coordinator.list(connectionId, sessionId).catch(() => undefined)
        this.deps.broadcast('deploy:changed', connectionId)
      },
      remove: async (name) => {
        say(`${RUNNER} remove ${name}`)
        await service().removeSite(name)
        this.deps.broadcast('deploy:changed', connectionId)
      },
      writeEnv: async (name, content) => {
        say(`write the env file of ${name} with umask 077 (contents hidden)`)
        await service().writeEnv(name, content)
      },
      keygen: (name) => {
        say(`${RUNNER} keygen ${name}`)
        return service().keygen(name)
      },
      repoError: async (name) => {
        say(`${RUNNER} check-remote ${name}`)
        try {
          await service().checkRemote(name)
          return null
        } catch (err) {
          return (err as Error).message
        }
      },
      deployAndWait: async (name) => {
        say(`${RUNNER} deploy ${name}`)
        return coordinator.waitForDeploy(connectionId, name, await coordinator.deploy(connectionId, name))
      }
    }
  }

  private ports(connectionId: string, sessionId: string, runId: string): CreateSitePorts & { runId: string } {
    const exec = this.exec(connectionId)
    const ssl = this.deps.ssl
    const output = (chunk: string) => this.deps.broadcast('create-site:output', { runId, chunk })
    const say = (command: string) => output(`$ ${command}\n`)
    return {
      runId,
      exec,
      dns: this.dnsPort(),
      deploy: this.deployPort(connectionId, sessionId, say),
      project: this.deps.project,
      tools: async () => {
        const { facts } = await ssl.service(connectionId).readConfig()
        output(`$ sh -s\n${TOOLS_SCRIPT.trimEnd().split('\n').map((line) => `  ${line}`).join('\n')}\n`)
        if (facts.paths.apache) say(`${facts.sudo.apache || facts.sudo.full ? 'sudo -n ' : ''}${facts.paths.apache} -M`)
        return detectTools(exec, facts)
      },
      siteBlockId: async (file, domain) => {
        const { blocks } = await ssl.service(connectionId).readConfig()
        const block = blocks.find((b) => posix.basename(b.file) === posix.basename(file) && b.names.some((n) => n.toLowerCase() === domain))
        return block?.id ?? null
      },
      issue: (request, onOutput) => ssl.issueWith(connectionId, sessionId, request, onOutput),
      resolves: async (name, address) => (await resolveAddresses(name).catch((): string[] => [])).includes(address),
      save: (record) => {
        this.deps.store.save(record)
        this.deps.broadcast('create-site:update', record)
      },
      output,
      now: this.deps.now
    }
  }
}
