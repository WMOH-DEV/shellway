import { randomUUID } from 'crypto'
import { app, ipcMain } from 'electron'
import { join } from 'path'
import { broadcast } from '../services/WindowManager'
import { sshExec } from '../utils/sshExec'
import { getSSHService } from './ssh.ipc'
import type { RemoteExec } from '../services/deploy/DeployService'
import type { ServerIpcContext } from '../services/server/context'
import { ActionEngine } from '../services/server/ActionEngine'
import { ActivityStore } from '../services/server/ActivityStore'
import { entryFromCreateSite, entryFromDeploy } from '../services/server/activityEntries'
import { RunStore } from '../services/server/RunStore'
import { ScanService } from '../services/server/ScanService'
import type { ActivityEntry, ActivityQuery, RunStatus, ServerArea, ServerResult } from '../../src/types/server/core'
import type { RunRecord } from '../../src/types/createSite'
import type { DeployRecord } from '../../src/types/deploy'
import { registerServerAreaIPC } from './server/areas'

type Broadcast = (channel: string, ...args: unknown[]) => void

const AREAS: ReadonlySet<string> = new Set<ServerArea>(['core', 'overview', 'sites', 'software', 'services', 'docker', 'databases', 'jobs', 'security', 'activity', 'settings', 'setup'])
const STATUSES: ReadonlySet<string> = new Set<RunStatus>(['running', 'done', 'failed', 'stopped', 'lost'])
const MAX_PROBES = 500

let ctx: ServerIpcContext | null = null
const sessions = new Map<string, string>()

function execFor(connectionId: string): RemoteExec | null {
  const conn = getSSHService().get(connectionId)
  if (!conn || conn.status !== 'connected') return null
  return (command, options) => sshExec(conn, command, options)
}

function str(value: unknown, label: string, max = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new Error(`Invalid ${label}`)
  return value
}

function probeIds(value: unknown): string[] | null {
  if (value === null) return null
  if (!Array.isArray(value) || value.length > MAX_PROBES) throw new Error('Invalid probe list')
  return value.map((id) => str(id, 'probe id', 128))
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label}`)
  return value
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}`)
  return value
}

function activityQuery(value: unknown): ActivityQuery {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object') throw new Error('Invalid activity query')
  const { area, status, text, limit, before } = value as Record<string, unknown>
  if (area !== undefined && (typeof area !== 'string' || !AREAS.has(area))) throw new Error('Invalid area')
  if (status !== undefined && (typeof status !== 'string' || !STATUSES.has(status))) throw new Error('Invalid status')
  if (text !== undefined && (typeof text !== 'string' || text.length > 200)) throw new Error('Invalid search text')
  return { area: area as ServerArea | undefined, status: status as RunStatus | undefined, text: text as string | undefined, limit: optionalNumber(limit, 'limit'), before: optionalNumber(before, 'time') }
}

function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<ServerResult<unknown>> => {
    try {
      return { success: true, data: await fn(...args) }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}

function requireContext(): ServerIpcContext {
  if (!ctx) throw new Error('The Server tab is not ready')
  return ctx
}

function record(entry: ActivityEntry | null): void {
  if (!entry || !ctx) return
  try {
    ctx.activity.record(entry)
  } catch (err) {
    console.warn(`[server] could not record activity: ${(err as Error).message}`)
  }
}

function mirror(channel: string, args: unknown[]): void {
  if (channel === 'deploy:finished') {
    const [connectionId, site, deploy] = args as [string, string, DeployRecord]
    const sessionKey = sessions.get(connectionId)
    if (sessionKey && typeof site === 'string' && deploy?.id) record(entryFromDeploy(sessionKey, site, deploy))
  }
  if (channel === 'create-site:update') {
    const run = args[0] as RunRecord
    if (run?.id && run.sessionId) record(entryFromCreateSite(run, Date.now()))
  }
}

export function withServerActivity(send: Broadcast): Broadcast {
  return (channel, ...args) => {
    mirror(channel, args)
    send(channel, ...args)
  }
}

export function notifyServerConnectionReady(connectionId: string, savedSessionId: string | undefined): void {
  if (savedSessionId) sessions.set(connectionId, savedSessionId)
  ctx?.engine.reattach(connectionId, savedSessionId)
}

export function notifyServerConnectionClosed(connectionId: string): void {
  ctx?.scan.forget(connectionId)
  ctx?.engine.forget(connectionId)
}

export function registerServerIPC(): void {
  const userData = app.getPath('userData')
  const scan = new ScanService({ execFor, broadcast, now: Date.now })
  const activity = new ActivityStore(join(userData, 'server-activity'))
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const engine = new ActionEngine({ execFor, scan, store: new RunStore(join(userData, 'server-runs.json')), activity, broadcast, newId: randomUUID, now: Date.now, sleep })
  engine.recover()
  ctx = { execFor, broadcast, engine, scan, activity }

  handle('server:scan', (c, ids, force) => scan.scan(str(c, 'connection'), probeIds(ids), bool(force, 'force')))
  handle('server:facts', (c) => scan.facts(str(c, 'connection')))
  handle('server:plan', (c, type, params) => engine.plan(str(c, 'connection'), str(type, 'action', 128), params))
  handle('server:run', (c, s, planId) => engine.run(str(c, 'connection'), str(s, 'session'), str(planId, 'plan')))
  handle('server:stop', (runId) => engine.stop(str(runId, 'run')))
  handle('server:runs', (c) => engine.runs(str(c, 'connection')))
  handle('server:activity', (s, query) => requireContext().activity.list(str(s, 'session'), activityQuery(query)))

  registerServerAreaIPC(ctx)
}
