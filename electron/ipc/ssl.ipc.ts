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
import type { CertbotAction, SslResult } from '../../src/types/ssl'

let coordinator: SslCoordinator | null = null
let store: SslLocalStore | null = null
let alertProbe: AlertProbe | null = null

const CERTBOT_ACTIONS: readonly CertbotAction[] = ['test', 'renew', 'force']
const RUN_ID = /^[A-Za-z0-9-]{1,64}$/

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

export function notifySslConnectionReady(connectionId: string, sessionId: string | undefined, label: string): void {
  if (!coordinator || !sessionId) return
  void coordinator.onConnected(connectionId, sessionId, label)
}

export function notifySslConnectionClosed(connectionId: string): void {
  coordinator?.forget(connectionId)
}
