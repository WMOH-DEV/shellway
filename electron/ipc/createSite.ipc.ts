import { randomUUID } from 'crypto'
import { ipcMain } from 'electron'
import { getSSHService } from './ssh.ipc'
import { requireCoordinator as deployCoordinator } from './deploy.ipc'
import { requireCoordinator as sslCoordinator } from './ssl.ipc'
import { broadcast } from '../services/WindowManager'
import { sshExec } from '../utils/sshExec'
import type { RemoteExec } from '../services/deploy/DeployService'
import { CreateSiteService } from '../services/createSite/CreateSiteService'
import { RunStore } from '../services/createSite/RunStore'
import type { CreateSiteInput, ResumeMode } from '../../src/types/createSite'
import type { DeployResult } from '../../src/types/deploy'

let service: CreateSiteService | null = null

function execFor(connectionId: string): RemoteExec | null {
  const conn = getSSHService().get(connectionId)
  if (!conn || conn.status !== 'connected') return null
  return (command, options) => sshExec(conn, command, options)
}

const savedSessions = new Map<string, string>()

export function rememberCreateSiteSession(connectionId: string, savedSessionId: string | undefined): void {
  if (savedSessionId) savedSessions.set(connectionId, savedSessionId)
}

export function forgetCreateSiteSession(connectionId: string): void {
  savedSessions.delete(connectionId)
}

const sessionOf = (connectionId: string): string | null => savedSessions.get(connectionId) ?? null

function str(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw new Error(`Invalid ${label}`)
  return value
}

const STRING_FIELDS = ['domain', 'siteName', 'folder', 'owner', 'template', 'phpVersion', 'repoUrl', 'branch', 'sourceMode', 'healthPath'] as const

function createSiteInput(value: unknown): CreateSiteInput {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid site')
  const input = value as Record<string, unknown>
  for (const field of STRING_FIELDS) if (typeof input[field] !== 'string') throw new Error(`Invalid ${field}`)
  if (typeof input.includeWww !== 'boolean' || typeof input.appPort !== 'number' || typeof input.pollMinutes !== 'number') throw new Error('Invalid site')
  if (typeof input.server !== 'object' || input.server === null || typeof input.https !== 'object' || input.https === null) throw new Error('Invalid site')
  const https = input.https as Record<string, unknown>
  if (typeof https.email !== 'string' || typeof https.redirect !== 'boolean' || typeof https.staging !== 'boolean') throw new Error('Invalid HTTPS settings')
  if (input.dns !== null) dnsSettings(input.dns)
  return input as unknown as CreateSiteInput
}

function dnsSettings(value: unknown): void {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid DNS settings')
  const dns = value as Record<string, unknown>
  const nullableString = (field: unknown) => field === null || typeof field === 'string'
  if (!nullableString(dns.zoneId) || !nullableString(dns.zoneName) || typeof dns.serverIp !== 'string' || typeof dns.proxied !== 'boolean') throw new Error('Invalid DNS settings')
}

function resumeMode(value: unknown): ResumeMode {
  if (value !== 'retry' && value !== 'continue') throw new Error('Invalid resume mode')
  return value
}

function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<DeployResult<unknown>> => {
    try {
      return { success: true, data: await fn(...args) }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}

function requireService(): CreateSiteService {
  if (!service) throw new Error('Create site is not ready')
  return service
}

export function registerCreateSiteIPC(): void {
  service = new CreateSiteService({
    execFor,
    sessionOf,
    ssl: sslCoordinator(),
    deploy: deployCoordinator(),
    store: new RunStore(),
    broadcast,
    newId: randomUUID,
    now: Date.now
  })
  handle('create-site:context', (c) => requireService().context(str(c, 'connection')))
  handle('create-site:check-name', (c, domain) => requireService().checkName(str(c, 'connection'), str(domain, 'domain')))
  handle('create-site:start', (c, s, input) => requireService().start(str(c, 'connection'), str(s, 'session'), createSiteInput(input)))
  handle('create-site:resume', (c, runId, mode) => requireService().resume(str(c, 'connection'), str(runId, 'run'), resumeMode(mode)))
  handle('create-site:stop', (runId) => requireService().stop(str(runId, 'run')))
  handle('create-site:remove', (c, runId) => requireService().remove(str(c, 'connection'), str(runId, 'run')))
  handle('create-site:runs', (s) => requireService().runs(str(s, 'session')))
}
