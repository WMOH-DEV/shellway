import type { DeployRecord } from '../../../src/types/deploy'
import type { ServerNotifications, ServerNotifyEvent } from '../../../src/types/server/notifications'
import type { ServerFacts } from '../../../src/types/server/core'
import { IDENTITY_PROBE, type ServerIdentity } from '../../../src/types/server/identity'
import { REBOOT_PROBE } from '../../../src/utils/server/overview/ids'
import type { RebootState } from '../../../src/utils/server/overview/reboot'
import { buildServiceList, probeData, type ServiceItem } from '../../../src/utils/server/services/list'
import { PROBE } from '../../../src/utils/server/services/probes'
import type { NotifyTarget } from './NotifySender'

export interface ServerNotifierDeps {
  settings(): ServerNotifications
  send(target: NotifyTarget, event: ServerNotifyEvent, text: string): Promise<void>
  onError(message: string): void
}

const DEPLOY_FAILURES: ReadonlySet<DeployRecord['status']> = new Set(['failed', 'reverted'])
const SERVICE_PROBES: readonly string[] = [PROBE.systemd, PROBE.supervisor, PROBE.pm2, PROBE.pm2Users]

export class ServerNotifier {
  private readonly criticalCounts = new Map<string, number>()
  private readonly rebootRequired = new Map<string, boolean>()
  private readonly hosts = new Map<string, string>()
  private readonly failedServices = new Map<string, Map<string, Set<string>>>()

  constructor(private readonly deps: ServerNotifierDeps) {}

  notify(event: ServerNotifyEvent, text: string): void {
    const { kind, url, events } = this.deps.settings()
    if (kind === 'off' || !events.includes(event)) return
    this.deps.send({ kind, url }, event, text).catch((err: Error) => this.deps.onError(err.message))
  }

  observe(channel: string, args: unknown[]): void {
    const [first, second, third] = args
    if (channel === 'deploy:finished' && typeof second === 'string' && isDeployRecord(third)) this.deployFinished(second, third)
    if (channel === 'ssl:critical' && typeof first === 'string' && typeof second === 'number') this.criticalChanged(first, second)
    if (channel === 'server:facts' && typeof first === 'string' && isFacts(second)) this.factsChanged(first, second)
  }

  private factsChanged(connectionId: string, facts: ServerFacts): void {
    const host = this.hostOf(connectionId, facts)
    this.rebootChanged(connectionId, host, facts)
    this.servicesChanged(connectionId, host, facts)
  }

  private hostOf(connectionId: string, facts: ServerFacts): string {
    const seen = probeData<ServerIdentity>(facts, IDENTITY_PROBE)?.hostname
    if (seen) this.hosts.set(connectionId, seen)
    return this.hosts.get(connectionId) ?? 'your server'
  }

  private rebootChanged(connectionId: string, host: string, facts: ServerFacts): void {
    const reboot = probeData<RebootState>(facts, REBOOT_PROBE)
    if (!reboot) return
    const previous = this.rebootRequired.get(connectionId) ?? false
    this.rebootRequired.set(connectionId, reboot.required)
    if (reboot.required && !previous) this.notify('reboot-required', `Shellway: ${host} needs a reboot to finish installing updates.`)
  }

  private servicesChanged(connectionId: string, host: string, facts: ServerFacts): void {
    const known = this.failedServices.get(connectionId) ?? new Map<string, Set<string>>()
    const alreadyFailed = new Set([...known.values()].flatMap((ids) => [...ids]))
    const fresh = new Map<string, string>()
    for (const probe of SERVICE_PROBES) {
      if (!probeData(facts, probe)) continue
      const failed = failedServices({ [probe]: facts[probe] })
      known.set(probe, new Set(failed.map((item) => item.id)))
      for (const item of failed) if (!alreadyFailed.has(item.id)) fresh.set(item.id, item.name)
    }
    this.failedServices.set(connectionId, known)
    if (fresh.size > 0) this.notify('service-down', `Shellway: ${[...new Set(fresh.values())].join(', ')} stopped on ${host}.`)
  }

  private deployFinished(site: string, record: DeployRecord): void {
    if (!DEPLOY_FAILURES.has(record.status)) return
    const note = record.note ? `: ${record.note}` : ''
    this.notify('deploy-failed', `Shellway: deploy of ${site} failed${note}`)
  }

  private criticalChanged(connectionId: string, count: number): void {
    const previous = this.criticalCounts.get(connectionId) ?? 0
    this.criticalCounts.set(connectionId, count)
    if (count <= previous) return
    this.notify('certificate-risk', `Shellway: ${count} ${count === 1 ? 'certificate needs' : 'certificates need'} attention`)
  }
}

function isDeployRecord(value: unknown): value is DeployRecord {
  return typeof value === 'object' && value !== null && typeof (value as DeployRecord).status === 'string'
}

function isFacts(value: unknown): value is ServerFacts {
  return typeof value === 'object' && value !== null
}

function failedServices(facts: ServerFacts): ServiceItem[] {
  return buildServiceList(facts).filter((item) => item.state === 'failed')
}
