import { createHash } from 'crypto'
import type { CreatedDnsRecord, CreatedResources, CreateSiteInput, PlanAction, ResumeMode, RunPhase, RunRecord, RunStep, RunStepStatus, ServerTools } from '../../../src/types/createSite'
import { deploySiteConfig } from '../../../src/utils/createSite/deploySite'
import { poolLayout, poolText } from '../../../src/utils/createSite/phpPool'
import { buildPlan } from '../../../src/utils/createSite/plan'
import { ROOT_SHELL, sitePaths } from '../../../src/utils/createSite/siteScripts'
import { TEMPLATES, siteFileText } from '../../../src/utils/createSite/templates'
import { siteNames } from '../../../src/utils/createSite/templates/shared'
import { assertLineage } from '../../../src/utils/createSite/validate'
import { EXIT_NGINX_TEST, EXIT_REFUSED, EXIT_RELOAD } from '../../../src/utils/ssl/originCa/scripts'
import type { WebServerDriver } from '../../../src/utils/webServer/driver'
import { shellEscape } from '../../utils/shellEscape'
import type { ExecResult } from '../../utils/sshExec'
import type { CreateSitePorts } from './ports'

const ROOT_TIMEOUT_MS = 120_000
const INSTALL_TIMEOUT_MS = 900_000
const SHORT_TIMEOUT_MS = 30_000
const DNS_COMMENT = 'Created by Shellway Create site'
const NOT_THERE = 'shellway: not there'
const CERT_EXISTS = 'shellway: certificate exists'
const SITE_SCRIPT_CLEAN_EXITS: ReadonlySet<number> = new Set([EXIT_REFUSED, EXIT_NGINX_TEST, EXIT_RELOAD])

export const dnsComment = (runId: string): string => `${DNS_COMMENT} ${runId}`

const sha256Of = (text: string): string => createHash('sha256').update(text.endsWith('\n') ? text : `${text}\n`).digest('hex')

export const NOTHING_CREATED: CreatedResources = { folder: null, siteFile: null, phpPool: null, modulesEnabled: [], dnsRecords: [], httpsSiteFile: null, certificate: null, deploySite: null }

export function newRunRecord(id: string, sessionId: string, input: CreateSiteInput, plan: PlanAction[], now: number): RunRecord {
  const steps: RunStep[] = plan.map((action) => ({ id: action.id, status: 'pending', startedAt: null, finishedAt: null }))
  return { id, sessionId, domain: input.domain, createdAt: now, server: input.server, input, steps, created: NOTHING_CREATED, phase: 'running', current: null, error: null, deployKey: null }
}

export const lastLine = (text: string): string => text.split('\n').map((line) => line.trim()).filter(Boolean).pop() ?? ''

export class CreateSiteRun {
  private stopRequested = false
  private tools: ServerTools | null = null

  constructor(private record: RunRecord, private readonly ports: CreateSitePorts, private readonly driver: WebServerDriver) {}

  get current(): RunRecord {
    return this.record
  }

  requestStop(): void {
    this.stopRequested = true
  }

  async run(mode: 'start' | ResumeMode): Promise<RunRecord> {
    this.stopRequested = false
    if (mode === 'continue') this.markFailed('skipped')
    this.update({ phase: 'running', error: null })
    let plan: PlanAction[]
    try {
      this.tools = await this.ports.tools()
      plan = buildPlan(this.input, this.tools, this.driver)
    } catch (err) {
      return this.finish('failed', (err as Error).message)
    }
    for (const step of this.record.steps) {
      if (step.status === 'done' || step.status === 'skipped') continue
      if (this.stopRequested) return this.finish('stopped', null)
      const failure = await this.runStep(step, plan.find((action) => action.id === step.id))
      if (failure !== null) return this.finish('failed', failure)
    }
    return this.finish('done', null)
  }

  private get input(): CreateSiteInput {
    return this.record.input
  }

  private async runStep(step: RunStep, action: PlanAction | undefined): Promise<string | null> {
    this.setStep(step.id, 'pending', { startedAt: this.ports.now(), finishedAt: null })
    this.update({ current: step.id })
    try {
      if (action) await this.execute(action)
      this.setStep(step.id, 'done', { finishedAt: this.ports.now() })
      return null
    } catch (err) {
      this.setStep(step.id, 'failed', { finishedAt: this.ports.now() })
      const message = (err as Error).message
      this.say(`${message}\n`)
      return message
    }
  }

  private execute(action: PlanAction): Promise<void> {
    switch (action.id) {
      case 'php': return this.install(action, `Installing PHP ${this.input.phpVersion} failed.`)
      case 'composer': return this.install(action, 'Installing composer failed.')
      case 'pm2': return this.install(action, 'Setting up pm2 failed.')
      case 'folder': return this.createFolder(action)
      case 'pool': return this.createPool(action)
      case 'modules': return this.enableModules(action)
      case 'site': return this.createSite(action)
      case 'dns': return action.chip === 'needs you' ? this.checkManualDns() : this.createDnsRecords(action)
      case 'https': return this.addHttps()
      case 'deploys': return this.addDeploySite()
      case 'first-deploy': return this.firstDeploy()
    }
  }

  private async install(action: PlanAction, fallback: string): Promise<void> {
    this.mustSucceed(await this.root(action, INSTALL_TIMEOUT_MS), fallback)
  }

  private async createFolder(action: PlanAction): Promise<void> {
    const recordedBefore = this.record.created.folder !== null
    if (!recordedBefore) this.created({ folder: { path: this.input.folder, createdByRun: true } })
    const result = await this.root(action)
    if (result.code === EXIT_REFUSED && !recordedBefore) this.created({ folder: null })
    this.mustSucceed(result, 'Creating the folder failed.')
  }

  private async createPool(action: PlanAction): Promise<void> {
    const { file } = poolLayout(this.input)
    const recordedBefore = this.record.created.phpPool !== null
    if (!recordedBefore) this.created({ phpPool: { path: file, sha256: sha256Of(poolText(this.input)) } })
    const result = await this.root(action)
    if (SITE_SCRIPT_CLEAN_EXITS.has(result.code) && !recordedBefore) this.created({ phpPool: null })
    this.mustSucceed(result, 'PHP-FPM did not accept the new pool.')
  }

  private async enableModules(action: PlanAction): Promise<void> {
    const result = await this.root(action)
    this.mustSucceed(result, 'Enabling the Apache modules failed.')
    const missing = TEMPLATES[this.input.template].apacheModules.filter((name) => !this.tools?.apacheModules.includes(name))
    this.created({ modulesEnabled: missing })
  }

  private async createSite(action: PlanAction): Promise<void> {
    const paths = sitePaths(this.input.server, this.input.siteName)
    const recordedBefore = this.record.created.siteFile !== null
    if (!recordedBefore) this.created({ siteFile: { path: paths.file, enabledLink: paths.enabledLink, sha256: sha256Of(siteFileText(this.input)) } })
    const result = await this.root(action)
    if (SITE_SCRIPT_CLEAN_EXITS.has(result.code) && !recordedBefore) this.created({ siteFile: null })
    this.mustSucceed(result, `${this.driver.label} did not accept the new site.`)
    const sha256 = await this.checksum(paths.file)
    if (sha256 === null) throw new Error(`${paths.file} is missing after it was written.`)
    this.created({ siteFile: { path: paths.file, enabledLink: paths.enabledLink, sha256 } })
  }

  private async checkManualDns(): Promise<void> {
    const address = this.input.dns?.serverIp ?? null
    const names = siteNames(this.input)
    if (address === null) throw new Error(`Point ${names.join(' and ')} at this server at your DNS provider, then press Continue from here.`)
    for (const name of names) {
      this.say(`Looking up ${name}\n`)
      if (!(await this.ports.resolves(name, address))) {
        throw new Error(`${name} does not point at ${address} yet. Create the record, wait a minute, then Retry. If the name is proxied, press Continue from here instead.`)
      }
    }
  }

  private async createDnsRecords(action: PlanAction): Promise<void> {
    const dns = this.ports.dns
    const zoneId = this.input.dns?.zoneId ?? null
    if (dns === null || zoneId === null) throw new Error('Cloudflare is not connected, so the DNS record cannot be created. Create it by hand, then press Continue from here.')
    const comment = dnsComment(this.record.id)
    for (const record of action.records) {
      if (this.record.created.dnsRecords.some((made) => made.name === record.name && made.type === record.type)) continue
      this.say(`Cloudflare: look up ${record.name}\n`)
      const existing = await dns.find(zoneId, record.name)
      const fromThisRun = existing.find((found) => found.comment === comment && found.type === record.type)
      if (fromThisRun) {
        this.say(`${record.name} was already created by this run. Keeping it.\n`)
        this.recordDns(zoneId, fromThisRun.id, record)
        continue
      }
      if (existing.length > 0) throw new Error(`${record.name} already has a DNS record (${existing[0].type} ${existing[0].content}). Nothing was changed in Cloudflare.`)
      this.say(`Cloudflare: create ${record.type} ${record.name} → ${record.content}${record.proxied ? ', proxied' : ''}\n`)
      const made = await dns.create(zoneId, { ...record, comment })
      this.recordDns(zoneId, made.id, record)
    }
  }

  private recordDns(zoneId: string, recordId: string, { name, type }: Pick<CreatedDnsRecord, 'name' | 'type'>): void {
    this.created({ dnsRecords: [...this.record.created.dnsRecords, { zoneId, recordId, name, type }] })
  }

  private async addHttps(): Promise<void> {
    const siteFile = this.record.created.siteFile
    if (siteFile === null) throw new Error('This run did not create the site file, so it will not add HTTPS to it. Use Add HTTPS in the SSL tab, or press Continue from here.')
    if (this.record.created.certificate === null) {
      if ((await this.checksum(siteFile.path)) !== siteFile.sha256) throw new Error(`${siteFile.path} changed after Shellway wrote it, so HTTPS was not added. Check the file, then use Add HTTPS in the SSL tab.`)
      await this.issueCertificate()
    }
    await this.recordChangedSiteFiles()
  }

  private async issueCertificate(): Promise<void> {
    const { file } = sitePaths(this.input.server, this.input.siteName)
    const blockId = await this.ports.siteBlockId(file, this.input.domain)
    if (blockId === null) throw new Error(`${this.driver.label} does not show a site for ${this.input.domain}. Check the site file, then Retry.`)
    const names = siteNames(this.input)
    const lineage = assertLineage(names[0])
    if (await this.certificateExists(lineage)) {
      throw new Error(`A certificate named ${lineage} is already on this server. Shellway will not change which names it covers. Use Add HTTPS in the SSL tab, or press Continue from here.`)
    }
    const result = await this.ports.issue({ blockId, names, ...this.input.https }, this.ports.output)
    if (!result.ok || result.lineage === null) throw new Error(result.hint ?? 'Getting the certificate failed. The site file was put back as it was.')
    this.created({ certificate: { lineage: result.lineage, issuedByRun: result.lineage === lineage } })
  }

  private async certificateExists(lineage: string): Promise<boolean> {
    const script = `if [ -e '/etc/letsencrypt/renewal/${lineage}.conf' ] || [ -e '/etc/letsencrypt/live/${lineage}' ]; then echo '${CERT_EXISTS}'; fi\n`
    const result = await this.rootScript(script, SHORT_TIMEOUT_MS)
    if (result.code !== 0) throw new Error(`Could not check for an existing certificate: ${lastLine(result.stderr) || 'no output'}`)
    return result.stdout.includes(CERT_EXISTS)
  }

  private async recordChangedSiteFiles(): Promise<void> {
    const siteFile = this.record.created.siteFile
    if (siteFile !== null) {
      const sha256 = await this.checksum(siteFile.path)
      if (sha256 !== null) this.created({ siteFile: { ...siteFile, sha256 } })
    }
    if (this.input.server.kind !== 'apache') return
    const httpsPath = sitePaths(this.input.server, `${this.input.siteName}-le-ssl`).file
    const sha256 = await this.checksum(httpsPath)
    if (sha256 !== null) this.created({ httpsSiteFile: { path: httpsPath, sha256 } })
  }

  private async addDeploySite(): Promise<void> {
    const config = deploySiteConfig(this.input)
    const { deploy } = this.ports
    if (this.record.created.deploySite !== config.name) {
      await deploy.ensureRunner()
      if ((await deploy.siteNames()).includes(config.name)) throw new Error(`A Deploy site named ${config.name} already exists. Nothing was changed.`)
      this.say(`Saving Deploy site ${config.name}\n`)
      try {
        await deploy.save(config)
      } catch (err) {
        if ((await deploy.siteNames().catch((): string[] => [])).includes(config.name)) this.created({ deploySite: config.name })
        throw err
      }
      this.created({ deploySite: config.name })
    }
    if (this.input.sourceMode === 'auto' && this.record.deployKey === null) this.update({ deployKey: await deploy.keygen(config.name) })
  }

  private async firstDeploy(): Promise<void> {
    const name = this.input.siteName
    const { deploy } = this.ports
    if (this.input.sourceMode === 'auto') {
      const repoError = await deploy.repoError(name)
      if (repoError !== null) throw new Error(`The server cannot read the repository yet (${repoError}). Add the deploy key to the repository, then Retry.`)
    }
    this.say(`Deploying ${this.input.branch}\n`)
    const finished = await deploy.deployAndWait(name)
    if (finished === null) throw new Error('The first deploy did not report back. Check it in the Deploy tab.')
    if (finished.status !== 'success' && finished.status !== 'warning') {
      throw new Error(`The first deploy ended as ${finished.status}${finished.note ? `: ${finished.note}` : ''}. Details are in the Deploy tab.`)
    }
  }

  private async root(action: PlanAction, timeoutMs = ROOT_TIMEOUT_MS): Promise<ExecResult> {
    if (action.script === null) throw new Error(action.note || `${action.title} cannot run from Shellway.`)
    return this.rootScript(action.script, timeoutMs)
  }

  private rootScript(script: string, timeoutMs: number): Promise<ExecResult> {
    this.say(`$ ${ROOT_SHELL}\n${script.trimEnd().split('\n').map((line) => `  ${line}`).join('\n')}\n`)
    return this.ports.exec(ROOT_SHELL, { stdin: script, timeoutMs, onOutput: this.ports.output })
  }

  private mustSucceed(result: ExecResult, fallback: string): void {
    if (result.code !== 0) throw new Error(lastLine(result.stderr) || fallback)
  }

  private async checksum(path: string): Promise<string | null> {
    const file = shellEscape(path)
    const script = `if [ -f ${file} ]; then sha256sum -- ${file}; else echo '${NOT_THERE}'; fi\n`
    const result = await this.rootScript(script, SHORT_TIMEOUT_MS)
    if (result.code !== 0) throw new Error(`Could not read ${path}: ${lastLine(result.stderr) || 'no output'}`)
    if (result.stdout.includes(NOT_THERE)) return null
    const sha256 = result.stdout.trim().split(/\s+/)[0] ?? ''
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Could not read the checksum of ${path}.`)
    return sha256
  }

  private markFailed(status: RunStepStatus): void {
    const failed = this.record.steps.find((step) => step.status === 'failed')
    if (failed) this.setStep(failed.id, status, {})
  }

  private setStep(id: RunStep['id'], status: RunStepStatus, times: Partial<Pick<RunStep, 'startedAt' | 'finishedAt'>>): void {
    this.update({ steps: this.record.steps.map((step) => (step.id === id ? { ...step, ...times, status } : step)) })
  }

  private created(changes: Partial<CreatedResources>): void {
    this.update({ created: { ...this.record.created, ...changes } })
  }

  private finish(phase: RunPhase, error: string | null): RunRecord {
    this.update({ phase, error, current: phase === 'done' ? null : this.record.current })
    return this.record
  }

  private update(changes: Partial<RunRecord>): void {
    this.record = { ...this.record, ...changes }
    this.ports.save(this.record)
  }

  private say(text: string): void {
    this.ports.output(text)
  }
}
