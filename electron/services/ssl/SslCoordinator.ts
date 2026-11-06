import type { RemoteExec } from '../deploy/DeployService'
import type { ActionResult, CertbotAction, CloudflareStatus, EdgeInfo, HostnameStatus, ServerScan, SslReport } from '../../../src/types/ssl'
import { CloudflareClient } from './CloudflareClient'
import { edgesWithoutZone, resolveAddresses } from './dnsEdge'
import { SslService } from './SslService'
import type { KnownHost, SslLocalStore } from './SslLocalStore'
import { buildReport, hostnamesOf, isPattern, unknownEdges } from './report'

export interface SslDeps {
  execFor: (connectionId: string) => RemoteExec | null
  store: SslLocalStore
  cloudflare: (token: string) => CloudflareClient
  serviceFor?: (exec: RemoteExec) => SslService
  edgesWithoutToken?: typeof edgesWithoutZone
  resolveHost?: (host: string) => Promise<string[]>
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
  private readonly certbotRuns = new Set<string>()
  private readonly criticalCounts = new Map<string, number>()
  private readonly connectionHosts = new Map<string, string>()
  private readonly warnedAt = new Map<string, number>()

  constructor(private readonly deps: SslDeps) {}

  service(connectionId: string): SslService {
    const exec = this.deps.execFor(connectionId)
    if (!exec) throw new Error('Not connected')
    return this.deps.serviceFor ? this.deps.serviceFor(exec) : new SslService(exec)
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
  }

  criticalCount(connectionId: string): number {
    return this.criticalCounts.get(connectionId) ?? 0
  }

  check(connectionId: string, sessionId: string): Promise<SslReport> {
    const running = this.checks.get(connectionId)
    if (running) return running
    const started = this.runCheck(connectionId, sessionId).finally(() => this.checks.delete(connectionId))
    this.checks.set(connectionId, started)
    return started
  }

  async runCertbot(connectionId: string, lineage: string, action: CertbotAction, runId: string): Promise<ActionResult> {
    if (this.certbotRuns.has(connectionId)) throw new Error('certbot is already running on this server. Wait for it to finish.')
    this.certbotRuns.add(connectionId)
    try {
      return await this.service(connectionId).runCertbot(lineage, action, (chunk) => this.deps.broadcast('ssl:output', runId, chunk))
    } finally {
      this.certbotRuns.delete(connectionId)
    }
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
    const critical = report.hostnames.filter(isCritical).length
    this.criticalCounts.set(connectionId, critical)
    this.deps.broadcast('ssl:critical', connectionId, critical)
    return report
  }

  private async edgesFor(scan: ServerScan, addresses: string[], cloudflare: CloudflareStatus): Promise<Record<string, EdgeInfo>> {
    const hosts = hostnamesOf(scan.blocks).filter((h) => !isPattern(h))
    const token = this.deps.store.cloudflareToken()
    if (!token) return (this.deps.edgesWithoutToken ?? edgesWithoutZone)(hosts, addresses, 'no Cloudflare token')
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
