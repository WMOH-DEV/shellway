import { ipcMain } from 'electron'
import { getSSHService } from './ssh.ipc'
import { broadcast } from '../services/WindowManager'
import { getNotificationService } from '../services/NotificationService'
import { sshExec } from '../utils/sshExec'
import type { RemoteExec } from '../services/deploy/DeployService'
import { AlertProbe, tlsProbe } from '../services/ssl/AlertProbe'
import { CloudflareClient } from '../services/ssl/CloudflareClient'
import { SslCoordinator } from '../services/ssl/SslCoordinator'
import { SslLocalStore } from '../services/ssl/SslLocalStore'
import { LINEAGE_NAME } from '../../src/utils/ssl/commands'
import type { CertbotAction, InstallRoute, IssueRequest, SslResult } from '../../src/types/ssl'

let coordinator: SslCoordinator | null = null
let store: SslLocalStore | null = null
let alertProbe: AlertProbe | null = null

const CERTBOT_ACTIONS: readonly CertbotAction[] = ['test', 'renew', 'force']
const INSTALL_ROUTES: readonly InstallRoute[] = ['snap', 'distro']
const RUN_ID = /^[A-Za-z0-9-]{1,64}$/
const MAX_NAMES = 100

function execFor(connectionId: string): RemoteExec | null {
  const conn = getSSHService().get(connectionId)
  if (!conn || conn.status !== 'connected') return null
  return (command, options) => sshExec(conn, command, options)
}

function str(value: unknown, label: string, max = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new Error(`Invalid ${label}`)
  return value
}

function matching(value: unknown, pattern: RegExp, label: string): string {
  const text = str(value, label)
  if (!pattern.test(text)) throw new Error(`Invalid ${label}`)
  return text
}

function certbotAction(value: unknown): CertbotAction {
  if (!CERTBOT_ACTIONS.includes(value as CertbotAction)) throw new Error('Invalid action')
  return value as CertbotAction
}

function installRoute(value: unknown): InstallRoute {
  if (!INSTALL_ROUTES.includes(value as InstallRoute)) throw new Error('Invalid route')
  return value as InstallRoute
}

function nameList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_NAMES) throw new Error(`Invalid ${label}`)
  return value.map((name) => str(name, label, 253))
}

function flag(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label}`)
  return value
}

function issueRequest(value: unknown): IssueRequest {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid request')
  const raw = value as Record<string, unknown>
  return {
    blockId: str(raw.blockId, 'site'),
    names: nameList(raw.names, 'names'),
    email: str(raw.email, 'email', 254),
    redirect: flag(raw.redirect, 'redirect setting'),
    staging: flag(raw.staging, 'staging setting')
  }
}

function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<SslResult<unknown>> => {
    try {
      return { success: true, data: await fn(...args) }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}

function requireCoordinator(): SslCoordinator {
  if (!coordinator) throw new Error('SSL service is not ready')
  return coordinator
}

export function registerSslIPC(): void {
  store = new SslLocalStore()
  coordinator = new SslCoordinator({
    execFor,
    store,
    cloudflare: (token) => new CloudflareClient(token),
    broadcast,
    notify: (title, body) => getNotificationService()?.notifySsl({ title, body }),
    now: () => Date.now()
  })
  alertProbe = new AlertProbe({
    store,
    probe: tlsProbe,
    notify: (title, body) => getNotificationService()?.notifySsl({ title, body }),
    now: () => Date.now()
  })
  alertProbe.start()

  handle('ssl:check', (c, s) => requireCoordinator().check(str(c, 'connection'), str(s, 'session')))
  handle('ssl:certbot', (c, lineage, action, runId) =>
    requireCoordinator().runCertbot(str(c, 'connection'), matching(lineage, LINEAGE_NAME, 'certificate name'), certbotAction(action), matching(runId, RUN_ID, 'run')))
  handle('ssl:https-readiness', (c, s, names) => {
    str(s, 'session')
    return requireCoordinator().httpsReadiness(str(c, 'connection'), nameList(names, 'names'))
  })
  handle('ssl:https-prep', (c) => requireCoordinator().httpsPrep(str(c, 'connection')))
  handle('ssl:https-install', (c, route, runId) =>
    requireCoordinator().httpsInstall(str(c, 'connection'), installRoute(route), matching(runId, RUN_ID, 'run')))
  handle('ssl:https-issue', (c, s, request, runId) =>
    requireCoordinator().httpsIssue(str(c, 'connection'), str(s, 'session'), issueRequest(request), matching(runId, RUN_ID, 'run')))
  handle('ssl:https-verify', (c, names, lineage) =>
    requireCoordinator().httpsVerify(str(c, 'connection'), nameList(names, 'names'), matching(lineage, LINEAGE_NAME, 'certificate name')))
  handle('ssl:https-email', (s) => requireCoordinator().httpsEmail(str(s, 'session')))
  handle('ssl:last-report', (c) => requireCoordinator().lastReport(str(c, 'connection')))
  handle('ssl:cf-status', () => requireCoordinator().cloudflareStatus())
  handle('ssl:cf-save', (token) => requireCoordinator().saveCloudflareToken(str(token, 'token', 512).trim()))
  handle('ssl:cf-remove', () => requireCoordinator().removeCloudflareToken())
  handle('ssl:critical-count', (c) => requireCoordinator().criticalCount(str(c, 'connection')))
  handle('ssl:alerts', () => store!.alertSettings())
  handle('ssl:alerts-enable', (enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid setting')
    store!.setProbeEnabled(enabled)
    return store!.alertSettings()
  })
}

export function notifySslConnectionReady(connectionId: string, sessionId: string | undefined, label: string, host: string): void {
  if (!coordinator || !sessionId) return
  void coordinator.onConnected(connectionId, sessionId, label, host)
}

export function notifySslConnectionClosed(connectionId: string): void {
  coordinator?.forget(connectionId)
}
