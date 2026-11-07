import { randomUUID } from 'node:crypto'
import type { RemoteExec } from '../deploy/DeployService'
import type {
  ActionResult, CertbotAction, CloudflareStatus, EdgeInfo, HostnameStatus, InstallRoute, IssueRequest, IssueResult,
  NameReadiness, OriginCert, PrepFacts, ServerScan, SslMode, SslReport, SwitchLeftover, SwitchPrepared, SwitchRequest, SwitchResult, VerifyResult,
  ZoneModeResult, ZonePreflight
} from '../../../src/types/ssl'
import { isIssuableName } from '../../../src/utils/ssl/https/issueCommands'
import { LINEAGE_NAME } from '../../../src/utils/ssl/commands'
import { CHANGE_NEEDS_FULL_READ, REMOVE_NEEDS_FULL_READ, isFullyRead } from '../../../src/utils/ssl/originCa/nginxRead'
import { removeFilesCommand } from '../../../src/utils/ssl/originCa/scripts'
import { CloudflareClient } from './CloudflareClient'
import { edgesWithoutZone, resolveAddresses } from './dnsEdge'
import { httpGet } from './https/httpGet'
import type { HttpGet } from './https/httpGet'
import { runInstall } from './https/install'
import { runIssue } from './https/issue'
import { detectPrep } from './https/prepFacts'
import { checkReadiness } from './https/readiness'
import { verifyHttps } from './https/verify'
import { runApply } from './originCa/apply'
import { blocksUsingLineage, leftoverTarget, readLeftover, undoRefusal } from './originCa/leftover'
import { runPrepare } from './originCa/prepare'
import { PreparedSwitches } from './originCa/preparedSwitches'
import { SHORT_TIMEOUT_MS } from './originCa/remoteRun'
import { runLineageRemoval, runUndo } from './originCa/undo'
import type { VerifyDeps } from './originCa/verifyServed'
import { SslService } from './SslService'
import type { OriginProbe } from './zoneMode/probeOrigin'
import { preflightZone, setZoneMode, type ZoneChange } from './zoneMode/zoneMode'
import type { KnownHost, SslLocalStore } from './SslLocalStore'
import { buildReport, hostnamesOf, isPattern, unknownEdges } from './report'
import { servingDriver } from '../../../src/utils/webServer'

export interface SslDeps {
  execFor: (connectionId: string) => RemoteExec | null
  store: SslLocalStore
  cloudflare: (token: string) => CloudflareClient
  serviceFor?: (exec: RemoteExec) => SslService
  edgesWithoutToken?: typeof edgesWithoutZone
  resolveHost?: (host: string) => Promise<string[]>
  httpGet?: HttpGet
  zoneProbe?: OriginProbe
  newId?: () => string
  sleep?: (ms: number) => Promise<void>
  broadcast: (channel: string, ...args: unknown[]) => void
  notify: (title: string, body: string) => void
  now: () => number
}

const isCritical = (host: HostnameStatus) => host.verdict === 'broken' || host.verdict === 'will-break'

function criticalSummary(label: string, critical: HostnameStatus[]): [string, string] {
  const [worst, ...rest] = critical
  const more = rest.length === 0 ? '' : rest.length === 1 ? '\n1 more hostname needs attention' : `\n${rest.length} more hostnames need attention`
  return [`SSL problem on ${label}`, `${worst.name}: ${worst.reason}${more}`]
}

const MAX_NAMES = 100

function issuableNames(names: string[]): string[] {
  if (names.length > MAX_NAMES) throw new Error(`At most ${MAX_NAMES} names at a time`)
  const bad = names.find((name) => !isIssuableName(name))
  if (bad !== undefined) throw new Error(`${bad} is not a valid hostname`)
  return names
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const NEEDS_FULL_SUDO = 'This needs full passwordless sudo on the server.'

const WARN_AGAIN_AFTER_MS = 12 * 60 * 60 * 1000

const isLoopback = (address: string) => address.startsWith('127.') || address === '::1'

const tokenHint = (token: string) => (token.length > 8 ? `…${token.slice(-4)}` : '…')

function probeTarget(address: string, fallbackHost: string): Pick<KnownHost, 'address' | 'port'> {
  const match = /^\[?([^\]]*?)\]?:(\d+)$/.exec(address)
  const host = match?.[1] ?? address
  const port = Number(match?.[2] ?? 443)
  return { address: host === '127.0.0.1' || host === '::1' || host === '' ? fallbackHost : host, port }
}

export class SslCoordinator {
  private readonly checks = new Map<string, Promise<SslReport>>()
  private readonly busy = new Set<string>()
  private readonly reports = new Map<string, SslReport>()
  private readonly criticalCounts = new Map<string, number>()
  private readonly connectionHosts = new Map<string, string>()
  private readonly warnedAt = new Map<string, number>()
  private readonly switches = new PreparedSwitches()
  private readonly checkedSessions = new Map<string, string>()
  private readonly zoneChanges = new Map<string, ZoneChange>()

  constructor(private readonly deps: SslDeps) {}

  service(connectionId: string): SslService {
    const exec = this.exec(connectionId)
    return this.deps.serviceFor ? this.deps.serviceFor(exec) : new SslService(exec)
  }

  private exec(connectionId: string): RemoteExec {
    const exec = this.deps.execFor(connectionId)
    if (!exec) throw new Error('Not connected')
    return exec
  }

  async onConnected(connectionId: string, sessionId: string, label: string, host: string): Promise<void> {
    if (host) this.connectionHosts.set(connectionId, host)
    if (!(sessionId in this.deps.store.knownHosts())) return
    try {
      const report = await this.check(connectionId, sessionId)
      const critical = report.hostnames.filter(isCritical)
      if (critical.length > 0 && this.shouldWarn(sessionId)) this.deps.notify(...criticalSummary(label, critical))
    } catch {
      this.criticalCounts.delete(connectionId)
    }
  }

  forget(connectionId: string): void {
    this.criticalCounts.delete(connectionId)
    this.connectionHosts.delete(connectionId)
    this.reports.delete(connectionId)
    this.switches.forget(connectionId)
    this.checkedSessions.delete(connectionId)
  }

  lastReport(connectionId: string): SslReport | null {
    return this.reports.get(connectionId) ?? null
  }

  criticalCount(connectionId: string): number {
    return this.criticalCounts.get(connectionId) ?? 0
  }

  check(connectionId: string, sessionId: string): Promise<SslReport> {
    this.checkedSessions.set(connectionId, sessionId)
    const running = this.checks.get(connectionId)
    if (running) return running
    const started = this.runCheck(connectionId, sessionId).finally(() => this.checks.delete(connectionId))
    this.checks.set(connectionId, started)
    return started
  }

  async runCertbot(connectionId: string, lineage: string, action: CertbotAction, runId: string): Promise<ActionResult> {
    return this.exclusive(connectionId, () => this.service(connectionId).runCertbot(lineage, action, this.outputTo(runId)))
  }

  httpsPrep(connectionId: string): Promise<PrepFacts> {
    return detectPrep(this.exec(connectionId))
  }

  httpsInstall(connectionId: string, route: InstallRoute, runId: string): Promise<ActionResult> {
    const exec = this.exec(connectionId)
    return this.exclusive(connectionId, () => runInstall(exec, route, this.outputTo(runId)))
  }

  httpsIssue(connectionId: string, sessionId: string, request: IssueRequest, runId: string): Promise<IssueResult> {
    const exec = this.exec(connectionId)
    const service = this.service(connectionId)
    const hooks = {
      now: this.deps.now,
      rememberEmail: () => this.deps.store.setHttpsEmail(sessionId, request.email),
      onOutput: this.outputTo(runId)
    }
    return this.exclusive(connectionId, () => runIssue(exec, () => service.readConfig(), request, hooks))
  }

  originPrepare(connectionId: string, sessionId: string, request: SwitchRequest, runId: string): Promise<SwitchPrepared> {
    const exec = this.exec(connectionId)
    return this.exclusive(connectionId, async () => {
      const report = await this.check(connectionId, sessionId)
      const token = this.deps.store.cloudflareToken()
      if (!token) throw new Error('Add a Cloudflare token first.')
      const hooks = { now: this.deps.now, newId: this.deps.newId ?? randomUUID, onOutput: this.outputTo(runId) }
      const prepared = await runPrepare({ exec, cloudflare: this.deps.cloudflare(token), report, request }, hooks)
      this.switches.add(connectionId, prepared)
      return prepared
    })
  }

  originApply(connectionId: string, sessionId: string, switchId: string, runId: string): Promise<SwitchResult> {
    const exec = this.exec(connectionId)
    return this.exclusive(connectionId, async () => {
      const prepared = this.switches.take(connectionId, switchId)
      const result = await runApply({ exec, onOutput: this.outputTo(runId), ...this.verifyDeps(connectionId) }, prepared)
      await this.refresh(connectionId, sessionId)
      return result
    })
  }

  originCancel(connectionId: string, switchId: string): Promise<void> {
    const exec = this.exec(connectionId)
    return this.exclusive(connectionId, async () => {
      const prepared = this.switches.peek(connectionId, switchId)
      const removed = await exec(removeFilesCommand(prepared.keyPath, prepared.certPath), { timeoutMs: SHORT_TIMEOUT_MS })
      if (removed.code !== 0) throw new Error('Could not remove the unused private key from the server.')
      this.switches.take(connectionId, switchId)
    })
  }

  async originLeftover(connectionId: string, name: string): Promise<SwitchLeftover | null> {
    const report = this.lastReport(connectionId)
    if (!report) return null
    return readLeftover(this.exec(connectionId), report, name, Math.floor(this.deps.now() / 1000))
  }

  originUndo(connectionId: string, sessionId: string, name: string, runId: string): Promise<SwitchResult> {
    const exec = this.exec(connectionId)
    return this.exclusive(connectionId, async () => {
      const report = await this.check(connectionId, sessionId)
      if (!isFullyRead(report.facts)) throw new Error(CHANGE_NEEDS_FULL_READ)
      const leftover = await readLeftover(exec, report, name, Math.floor(this.deps.now() / 1000))
      const refusal = undoRefusal(leftover)
      const target = leftoverTarget(report, name)
      if (refusal || !leftover || !target) throw new Error(refusal ?? 'This site is no longer in the nginx configuration.')
      const deps = { exec, onOutput: this.outputTo(runId), now: this.deps.now, ...this.verifyDeps(connectionId) }
      const result = await runUndo(deps, { driver: servingDriver(report.facts), file: target.block.file, names: target.block.names.map((n) => n.toLowerCase()), prefix: target.prefix, leftover })
      await this.refresh(connectionId, sessionId)
      return result
    })
  }

  originRemoveLineage(connectionId: string, lineage: string, runId: string): Promise<ActionResult> {
    if (!LINEAGE_NAME.test(lineage)) throw new Error('Invalid certificate name')
    const exec = this.exec(connectionId)
    const service = this.service(connectionId)
    return this.exclusive(connectionId, async () => {
      const config = await service.readConfig()
      if (!config.facts.sudo.full) throw new Error(NEEDS_FULL_SUDO)
      if (!isFullyRead(config.facts)) throw new Error(REMOVE_NEEDS_FULL_READ)
      const users = blocksUsingLineage(config.blocks, lineage)
      if (users.length > 0) throw new Error(`${lineage} is still used by ${users.map((b) => b.names[0] ?? b.id).join(', ')}. Switch those sites first.`)
      const result = await runLineageRemoval(exec, lineage, this.outputTo(runId))
      await this.refreshRemembered(connectionId)
      return result
    })
  }

  private verifyDeps(connectionId: string): VerifyDeps {
    const service = this.service(connectionId)
    return {
      probe: async (names): Promise<Record<string, OriginCert>> => service.probeNames(names, await service.readConfig()),
      httpGet: this.deps.httpGet ?? httpGet,
      sleep: this.deps.sleep ?? pause
    }
  }

  private async refreshRemembered(connectionId: string): Promise<void> {
    const sessionId = this.checkedSessions.get(connectionId)
    if (sessionId !== undefined) await this.refresh(connectionId, sessionId)
  }

  private async refresh(connectionId: string, sessionId: string): Promise<void> {
    try {
      await this.check(connectionId, sessionId)
    } catch {
      this.criticalCounts.delete(connectionId)
    }
  }

  httpsEmail(sessionId: string): string {
    return this.deps.store.httpsEmail(sessionId)
  }

  httpsVerify(connectionId: string, names: string[], lineage: string): Promise<VerifyResult> {
    if (!LINEAGE_NAME.test(lineage)) throw new Error('Invalid certificate name')
    const exec = this.exec(connectionId)
    const service = this.service(connectionId)
    return verifyHttps({
      names: issuableNames(names),
      probeServer: async () => service.probeNames(names, await service.readConfig()),
      httpGet: this.deps.httpGet ?? httpGet,
      renewalTest: () => this.exclusive(connectionId, () => service.runCertbot(lineage, 'test', () => {})),
      detect: () => detectPrep(exec)
    })
  }

  async httpsReadiness(connectionId: string, names: string[]): Promise<NameReadiness[]> {
    issuableNames(names)
    const facts = await this.service(connectionId).readFacts()
    const serverAddresses = await this.serverAddresses(connectionId, facts.addresses)
    const cloudflare = await this.cloudflareStatus()
    return checkReadiness(names, {
      serverAddresses,
      resolve: this.deps.resolveHost ?? resolveAddresses,
      httpGet: this.deps.httpGet ?? httpGet,
      edgesOf: (hosts) => this.cloudflareEdges(hosts, serverAddresses, cloudflare)
    })
  }

  async zonePreflight(zone: string): Promise<ZonePreflight> {
    return preflightZone(zone, this.zoneModeDeps())
  }

  async zoneSetMode(zone: string, mode: SslMode, confirmedUnknown: string[]): Promise<ZoneModeResult> {
    const result = await setZoneMode(zone, mode, confirmedUnknown, this.zoneModeDeps())
    this.refreshZoneConnections(result.zone)
    return result
  }

  private zoneModeDeps() {
    const token = this.deps.store.cloudflareToken()
    if (!token) throw new Error('Add a Cloudflare token first.')
    return { client: this.deps.cloudflare(token), changes: this.zoneChanges, probe: this.deps.zoneProbe }
  }

  private refreshZoneConnections(zone: string): void {
    for (const [connectionId, report] of this.reports) {
      if (report.hostnames.some((host) => host.edge.zone === zone)) void this.refreshRemembered(connectionId)
    }
  }

  private async exclusive<T>(connectionId: string, task: () => Promise<T>): Promise<T> {
    if (this.busy.has(connectionId)) throw new Error('Another certificate task is already running on this server. Wait for it to finish.')
    this.busy.add(connectionId)
    try {
      return await task()
    } finally {
      this.busy.delete(connectionId)
    }
  }

  private outputTo(runId: string): (chunk: string) => void {
    return (chunk) => this.deps.broadcast('ssl:output', runId, chunk)
  }

  async cloudflareStatus(): Promise<CloudflareStatus> {
    const token = this.deps.store.cloudflareToken()
    if (!token) return { saved: false, tokenHint: '', error: null, permissions: [], zones: [] }
    return this.statusFor(token)
  }

  async saveCloudflareToken(token: string): Promise<CloudflareStatus> {
    const status = await this.statusFor(token)
    if (status.error) throw new Error(status.error)
    this.deps.store.setCloudflareToken(token)
    return status
  }

  removeCloudflareToken(): void {
    this.deps.store.setCloudflareToken(null)
  }

  private async statusFor(token: string): Promise<CloudflareStatus> {
    try {
      const check = await this.deps.cloudflare(token).check()
      return { saved: true, tokenHint: tokenHint(token), ...check }
    } catch (err) {
      return { saved: true, tokenHint: tokenHint(token), error: (err as Error).message, permissions: [], zones: [] }
    }
  }

  private shouldWarn(sessionId: string): boolean {
    const now = this.deps.now()
    const last = this.warnedAt.get(sessionId)
    if (last !== undefined && now - last < WARN_AGAIN_AFTER_MS) return false
    this.warnedAt.set(sessionId, now)
    return true
  }

  private async serverAddresses(connectionId: string, reported: string[]): Promise<string[]> {
    const host = this.connectionHosts.get(connectionId)
    const resolve = this.deps.resolveHost ?? resolveAddresses
    const connected = host ? await resolve(host).catch(() => []) : []
    return [...new Set([...connected.filter((a) => !isLoopback(a)), ...reported])]
  }

  private async runCheck(connectionId: string, sessionId: string): Promise<SslReport> {
    const scan = await this.service(connectionId).scan()
    const addresses = await this.serverAddresses(connectionId, scan.facts.addresses)
    const cloudflare = await this.cloudflareStatus()
    const edges = await this.edgesFor(scan, addresses, cloudflare)
    const report = buildReport(scan, edges, cloudflare, Math.floor(this.deps.now() / 1000))
    this.rememberHosts(sessionId, scan, addresses[0] ?? '')
    if (!this.deps.execFor(connectionId)) return report
    this.reports.set(connectionId, report)
    const critical = report.hostnames.filter(isCritical).length
    this.criticalCounts.set(connectionId, critical)
    this.deps.broadcast('ssl:critical', connectionId, critical)
    return report
  }

  private async edgesFor(scan: ServerScan, addresses: string[], cloudflare: CloudflareStatus): Promise<Record<string, EdgeInfo>> {
    const hosts = hostnamesOf(scan.blocks).filter((h) => !isPattern(h))
    return (await this.cloudflareEdges(hosts, addresses, cloudflare)) ?? (this.deps.edgesWithoutToken ?? edgesWithoutZone)(hosts, addresses, 'no Cloudflare token')
  }

  private async cloudflareEdges(hosts: string[], addresses: string[], cloudflare: CloudflareStatus): Promise<Record<string, EdgeInfo> | null> {
    const token = this.deps.store.cloudflareToken()
    if (!token) return null
    if (cloudflare.error) return unknownEdges(hosts, cloudflare.error)
    try {
      return await this.deps.cloudflare(token).edges(hosts, addresses, cloudflare.zones)
    } catch (err) {
      return unknownEdges(hosts, (err as Error).message)
    }
  }

  private rememberHosts(sessionId: string, scan: ServerScan, fallback: string): void {
    if (!fallback) return
    const known = scan.blocks
      .filter((b) => b.tls)
      .flatMap((b) => b.names.filter((n) => n && n !== '_' && !isPattern(n)).map((host) => ({ host, ...probeTarget(b.probeAddress, fallback) })))
    this.deps.store.setKnownHosts(sessionId, known)
  }
}
