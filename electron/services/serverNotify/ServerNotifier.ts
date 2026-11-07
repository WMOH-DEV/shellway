import type { DeployRecord } from '../../../src/types/deploy'
import type { ServerNotifications, ServerNotifyEvent } from '../../../src/types/server/notifications'
import type { NotifyTarget } from './NotifySender'

export interface ServerNotifierDeps {
  settings(): ServerNotifications
  send(target: NotifyTarget, event: ServerNotifyEvent, text: string): Promise<void>
  onError(message: string): void
}

const DEPLOY_FAILURES: ReadonlySet<DeployRecord['status']> = new Set(['failed', 'reverted'])

export class ServerNotifier {
  private readonly criticalCounts = new Map<string, number>()

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
