import type { RemoteExec } from '../deploy/DeployService'
import type { ActionResult, CertbotAction, CloudflareStatus, EdgeInfo, ServerScan, SslReport } from '../../../src/types/ssl'
import { CloudflareClient } from './CloudflareClient'
import { SslService } from './SslService'
import type { KnownHost, SslLocalStore } from './SslLocalStore'
import { buildReport, hostnamesOf, isPattern, unknownEdges } from './report'

export interface SslDeps {
  execFor: (connectionId: string) => RemoteExec | null
  store: SslLocalStore
  cloudflare: (token: string) => CloudflareClient
  broadcast: (channel: string, ...args: unknown[]) => void
  now: () => number
}

const tokenHint = (token: string) => (token.length > 8 ? `…${token.slice(-4)}` : '…')

function probeTarget(address: string, fallbackHost: string): Pick<KnownHost, 'address' | 'port'> {
  const match = /^\[?([^\]]*?)\]?:(\d+)$/.exec(address)
  const host = match?.[1] ?? address
  const port = Number(match?.[2] ?? 443)
  return { address: host === '127.0.0.1' || host === '::1' || host === '' ? fallbackHost : host, port }
}

export class SslCoordinator {
  private readonly checks = new Map<string, Promise<SslReport>>()

  constructor(private readonly deps: SslDeps) {}

  service(connectionId: string): SslService {
    const exec = this.deps.execFor(connectionId)
    if (!exec) throw new Error('Not connected')
    return new SslService(exec)
  }

  check(connectionId: string, sessionId: string): Promise<SslReport> {
    const running = this.checks.get(connectionId)
    if (running) return running
    const started = this.runCheck(connectionId, sessionId).finally(() => this.checks.delete(connectionId))
    this.checks.set(connectionId, started)
    return started
  }

  runCertbot(connectionId: string, lineage: string, action: CertbotAction, runId: string): Promise<ActionResult> {
    return this.service(connectionId).runCertbot(lineage, action, (chunk) => this.deps.broadcast('ssl:output', runId, chunk))
  }

  async cloudflareStatus(): Promise<CloudflareStatus> {
    const token = this.deps.store.cloudflareToken()
    if (!token) return { saved: false, tokenHint: '', error: null, permissions: [], zones: [] }
    return this.statusFor(token)
  }

  async saveCloudflareToken(token: string): Promise<CloudflareStatus> {
    const status = await this.statusFor(token)
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

  private async runCheck(connectionId: string, sessionId: string): Promise<SslReport> {
    const scan = await this.service(connectionId).scan()
    const cloudflare = await this.cloudflareStatus()
    const edges = await this.edgesFor(scan, cloudflare)
    const report = buildReport(scan, edges, cloudflare, Math.floor(this.deps.now() / 1000))
    this.rememberHosts(sessionId, scan)
    return report
  }

  private async edgesFor(scan: ServerScan, cloudflare: CloudflareStatus): Promise<Record<string, EdgeInfo>> {
    const hosts = hostnamesOf(scan.blocks).filter((h) => !isPattern(h))
    const token = this.deps.store.cloudflareToken()
    if (!token) return unknownEdges(hosts, 'no Cloudflare token')
    if (cloudflare.error) return unknownEdges(hosts, cloudflare.error)
    try {
      return await this.deps.cloudflare(token).edges(hosts, scan.facts.addresses, cloudflare.zones)
    } catch (err) {
      return unknownEdges(hosts, (err as Error).message)
    }
  }

  private rememberHosts(sessionId: string, scan: ServerScan): void {
    const fallback = scan.facts.addresses[0] ?? ''
    if (!fallback) return
    const known = scan.blocks
      .filter((b) => b.tls)
      .flatMap((b) => b.names.filter((n) => n && n !== '_' && !isPattern(n)).map((host) => ({ host, ...probeTarget(b.probeAddress, fallback) })))
    this.deps.store.setKnownHosts(sessionId, known)
  }
}
