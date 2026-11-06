import type { DeployOptions, DeployRecord, ShipPreview, SiteSummary } from '../../../src/types/deploy'
import type { RemoteExec } from './DeployService'
import { DeployService, newDeployId } from './DeployService'
import type { DeployLocalStore } from './DeployLocalStore'
import type { LocalGit } from './LocalGit'
import { approvalArgs, deployFromPc } from './pcDeploy'

export interface CoordinatorDeps {
  execFor: (connectionId: string) => RemoteExec | null
  local: Pick<DeployLocalStore, 'usesDeploy' | 'markUsesDeploy' | 'lastSeen' | 'setLastSeen'>
  git: LocalGit
  notify: (title: string, body: string) => void
  broadcast: (channel: string, ...args: unknown[]) => void
  trackIntervalMs?: number
}

interface ConnectionSites {
  sessionId: string
  summaries: SiteSummary[]
}

const TRACK_INTERVAL_MS = 3_000
const TRACK_MAX_POLLS = 1_200
const TRACK_MAX_MISSING_POLLS = 10
const WATCH_INTERVAL_MS = 60_000
const WATCH_MAX_BACKOFF_MS = 30 * 60_000

const STATUS_TITLES: Record<Exclude<DeployRecord['status'], 'running'>, string> = {
  success: 'Deploy finished',
  warning: 'Deploy finished with warnings',
  failed: 'Deploy failed',
  reverted: 'Deploy failed and was reverted',
  waiting: 'Deploy waiting for approval',
  cancelled: 'Deploy cancelled'
}

const ENV_TITLES: Partial<Record<DeployRecord['status'], string>> = {
  success: 'Env change applied',
  warning: 'Env change applied with warnings',
  failed: 'Env change failed'
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const newestFinish = (summary: SiteSummary): number =>
  summary.history.reduce((max, r) => Math.max(max, r.finished ?? 0), 0)

export class DeployCoordinator {
  private readonly sites = new Map<string, ConnectionSites>()
  private readonly tracking = new Set<string>()
  private watchTimer: ReturnType<typeof setInterval> | null = null
  private watching = false
  private readonly headCheckRetryAt = new Map<string, { failures: number; at: number }>()

  constructor(private readonly deps: CoordinatorDeps) {}

  service(connectionId: string): DeployService {
    const exec = this.deps.execFor(connectionId)
    if (!exec) throw new Error('Not connected')
    return new DeployService(exec)
  }

  async list(connectionId: string, sessionId: string): Promise<SiteSummary[]> {
    const summaries = await this.service(connectionId).listSites()
    this.sites.set(connectionId, { sessionId, summaries })
    if (summaries.length > 0) this.deps.local.markUsesDeploy(sessionId)
    for (const summary of summaries) this.deps.local.setLastSeen(sessionId, summary.config.name, newestFinish(summary))
    return summaries
  }

  async deploy(connectionId: string, name: string, options: DeployOptions = {}): Promise<string> {
    const service = this.service(connectionId)
    const site = (await service.listSites()).find((s) => s.config.name === name)
    if (!site) throw new Error(`Unknown site ${name}`)
    if (site.state.busy) throw new Error('A deploy is already running for this site')
    const id = newDeployId()
    if (site.config.sourceMode === 'pc') {
      await deployFromPc(service, this.deps.git, site.config, site.state, id, 'manual', options)
    } else {
      const pin = options.commit ? ['--commit', options.commit] : []
      await service.startDeploy(name, id, [...pin, '--trigger', 'manual', ...approvalArgs(options)])
    }
    this.track(connectionId, name, id)
    return id
  }

  async preview(connectionId: string, name: string): Promise<ShipPreview> {
    const service = this.service(connectionId)
    const site = (await service.listSites()).find((s) => s.config.name === name)
    if (!site) throw new Error(`Unknown site ${name}`)
    if (site.config.sourceMode === 'auto') return service.preview(name)
    const { repoUrl, branch, migrationsPath } = site.config
    return this.deps.git.preview({ url: repoUrl, branch, live: site.state.current, pending: site.state.pending, migrationsPath })
  }

  async rollback(connectionId: string, name: string, targetId: string): Promise<string> {
    const id = newDeployId()
    await this.service(connectionId).startRollback(name, targetId, id)
    this.track(connectionId, name, id)
    return id
  }

  async approve(connectionId: string, name: string): Promise<string> {
    const id = newDeployId()
    await this.service(connectionId).startApprove(name, id)
    this.track(connectionId, name, id)
    return id
  }

  async apply(connectionId: string, name: string): Promise<string> {
    const id = newDeployId()
    await this.service(connectionId).startApply(name, id)
    this.track(connectionId, name, id)
    return id
  }

  async cancel(connectionId: string, name: string): Promise<void> {
    await this.service(connectionId).cancel(name)
    this.deps.broadcast('deploy:changed', connectionId)
  }

  async resume(connectionId: string, name: string): Promise<void> {
    await this.service(connectionId).resume(name)
    this.deps.broadcast('deploy:changed', connectionId)
  }

  async onConnected(connectionId: string, sessionId: string, label: string): Promise<void> {
    if (!this.deps.local.usesDeploy(sessionId)) return
    try {
      const summaries = await this.service(connectionId).listSites()
      this.sites.set(connectionId, { sessionId, summaries })
      this.summariseMissed(sessionId, label, summaries)
      this.deps.broadcast('deploy:changed', connectionId)
    } catch {
      this.sites.delete(connectionId)
    }
  }

  forget(connectionId: string): void {
    this.sites.delete(connectionId)
    for (const key of this.headCheckRetryAt.keys()) if (key.startsWith(`${connectionId}:`)) this.headCheckRetryAt.delete(key)
  }

  startWatching(): void {
    if (this.watchTimer) return
    this.watchTimer = setInterval(() => void this.watchOnce(), WATCH_INTERVAL_MS)
    this.watchTimer.unref?.()
  }

  stopWatching(): void {
    if (this.watchTimer) clearInterval(this.watchTimer)
    this.watchTimer = null
  }

  async watchOnce(): Promise<void> {
    if (this.watching) return
    this.watching = true
    try {
      for (const [connectionId, entry] of this.sites) {
        if (!this.deps.execFor(connectionId)) continue
        for (const summary of entry.summaries) await this.autoDeployFromPc(connectionId, summary)
      }
    } finally {
      this.watching = false
    }
  }

  private async autoDeployFromPc(connectionId: string, cached: SiteSummary): Promise<void> {
    const { config } = cached
    if (config.sourceMode !== 'pc' || !config.pcAuto || cached.state.busy) return
    const head = await this.remoteHeadWithBackoff(`${connectionId}:${config.name}`, config.repoUrl, config.branch)
    if (!head || !this.isNewHead(cached, head)) return
    const fresh = await this.refreshSite(connectionId, config.name)
    if (!fresh || fresh.state.busy || !this.isNewHead(fresh, head)) return
    fresh.state.lastAttempted = head
    const id = newDeployId()
    try {
      await deployFromPc(this.service(connectionId), this.deps.git, fresh.config, fresh.state, id, 'pc')
      this.track(connectionId, config.name, id)
    } catch (err) {
      this.deps.notify('Auto deploy could not start', `${config.name}: ${(err as Error).message}`)
    }
  }

  private isNewHead(summary: SiteSummary, head: string): boolean {
    return head !== summary.state.current && head !== summary.state.lastAttempted
  }

  private async remoteHeadWithBackoff(key: string, url: string, branch: string): Promise<string | null> {
    const retry = this.headCheckRetryAt.get(key)
    if (retry && Date.now() < retry.at) return null
    try {
      const head = await this.deps.git.lsRemote(url, branch)
      this.headCheckRetryAt.delete(key)
      return head
    } catch {
      const failures = (retry?.failures ?? 0) + 1
      const delay = Math.min(WATCH_INTERVAL_MS * 2 ** failures, WATCH_MAX_BACKOFF_MS)
      this.headCheckRetryAt.set(key, { failures, at: Date.now() + delay })
      return null
    }
  }

  private async refreshSite(connectionId: string, name: string): Promise<SiteSummary | undefined> {
    const entry = this.sites.get(connectionId)
    if (!entry) return undefined
    try {
      entry.summaries = await this.service(connectionId).listSites()
    } catch {
      return undefined
    }
    return entry.summaries.find((s) => s.config.name === name)
  }

  private summariseMissed(sessionId: string, label: string, summaries: SiteSummary[]): void {
    const lines: string[] = []
    for (const summary of summaries) {
      const seen = this.deps.local.lastSeen(sessionId, summary.config.name)
      const missed = summary.history.filter((r) => (r.finished ?? 0) > seen)
      if (missed.length === 0) continue
      const failed = missed.filter((r) => r.status === 'failed' || r.status === 'reverted').length
      lines.push(`${summary.config.name}: ${missed.length} deploy${missed.length > 1 ? 's' : ''}${failed ? `, ${failed} failed` : ''}`)
      this.deps.local.setLastSeen(sessionId, summary.config.name, newestFinish(summary))
    }
    if (lines.length > 0) this.deps.notify(`Deploys on ${label} while you were away`, lines.join('\n'))
  }

  private track(connectionId: string, name: string, id: string): void {
    const key = `${connectionId}:${name}:${id}`
    if (this.tracking.has(key)) return
    this.tracking.add(key)
    this.deps.broadcast('deploy:changed', connectionId)
    void this.pollUntilFinished(connectionId, name, id).finally(() => this.tracking.delete(key))
  }

  private async pollUntilFinished(connectionId: string, name: string, id: string): Promise<void> {
    let missing = 0
    for (let poll = 0; poll < TRACK_MAX_POLLS; poll++) {
      await sleep(this.deps.trackIntervalMs ?? TRACK_INTERVAL_MS)
      if (!this.deps.execFor(connectionId)) return
      const record = await this.findRecord(connectionId, name, id)
      if (!record) {
        missing += 1
        if (missing >= TRACK_MAX_MISSING_POLLS) return this.deps.broadcast('deploy:changed', connectionId)
        continue
      }
      if (record.status === 'running') continue
      return this.finished(connectionId, name, record)
    }
  }

  private async findRecord(connectionId: string, name: string, id: string): Promise<DeployRecord | undefined> {
    try {
      return (await this.service(connectionId).history(name)).find((r) => r.id === id)
    } catch {
      return undefined
    }
  }

  private finished(connectionId: string, name: string, record: DeployRecord): void {
    const entry = this.sites.get(connectionId)
    if (entry && record.finished) this.deps.local.setLastSeen(entry.sessionId, name, record.finished)
    const title = (record.trigger === 'env' ? ENV_TITLES[record.status] : undefined)
      ?? STATUS_TITLES[record.status as keyof typeof STATUS_TITLES] ?? 'Deploy finished'
    this.deps.notify(title, `${name}${record.note ? `: ${record.note}` : ''}`)
    this.deps.broadcast('deploy:finished', connectionId, name, record)
    this.deps.broadcast('deploy:changed', connectionId)
  }
}
