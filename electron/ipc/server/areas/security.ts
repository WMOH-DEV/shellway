import { ipcMain } from 'electron'
import { randomBytes } from 'crypto'
import type { ServerResult } from '../../../../src/types/server/core'
import { validateGuardRequest, type GuardPreview, type GuardRun, type SecuritySessionInfo } from '../../../../src/utils/server/security/guard'
import type { ServerIpcContext } from '../../../services/server/context'
import type { SSHConnectionConfig } from '../../../services/SSHService'
import { LockoutGuard, previewGuard, type ActivitySink } from '../../../services/serverSecurity/LockoutGuard'
import { freshLogin, promptFreeLogin } from '../../../services/serverSecurity/freshLogin'
import { sessionConfigOf } from '../../../services/serverSecurity/sessionConfig'
import { sessionKeyInfo } from '../../../services/serverSecurity/sessionKey'
import { getSSHService } from '../../ssh.ipc'

const CONNECTION_ID = /^[A-Za-z0-9:._-]{1,128}$/
const GUARD_UPDATE = 'server:security:guard-update'
const runs = new Map<string, GuardRun>()

const fail = (error: unknown): { success: false; error: string } => ({ success: false, error: error instanceof Error ? error.message : String(error) })

function assertConnectionId(value: unknown): string {
  if (typeof value !== 'string' || !CONNECTION_ID.test(value)) throw new Error('Invalid connection')
  return value
}

function assertSessionKey(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) throw new Error('Invalid session')
  return value
}

async function verifiableConfig(connectionId: string): Promise<SSHConnectionConfig> {
  const config = await sessionConfigOf(getSSHService().get(connectionId))
  if (!config) throw new Error('Shellway cannot open a second connection for this session. Save the session first, then reconnect.')
  if (!promptFreeLogin(config)) throw new Error('This session asks for input when logging in, so Shellway cannot check a new connection by itself. Firewall and SSH changes are turned off for it.')
  return config
}

async function sessionInfo(connectionId: string): Promise<SecuritySessionInfo> {
  const config = await sessionConfigOf(getSSHService().get(connectionId))
  if (!config) return { keyAuth: false, fingerprints: [], source: 'none', canVerify: false, reason: 'Save this session to allow firewall and SSH changes.', configPort: 0 }
  const keys = await sessionKeyInfo(config)
  const canVerify = promptFreeLogin(config)
  return { ...keys, canVerify, reason: canVerify ? '' : 'This session asks for input when logging in, so Shellway cannot check a new connection by itself.', configPort: config.port }
}

const isBusy = (connectionId: string): boolean => {
  const run = runs.get(connectionId)
  return run !== undefined && (run.outcome === 'running' || run.outcome === 'reverting')
}

export function registerSecurityIPC(ctx: ServerIpcContext): void {
  const activity = (ctx as ServerIpcContext & { activity?: ActivitySink }).activity

  ipcMain.handle('server:security:session', async (_event, rawConnectionId: unknown): Promise<ServerResult<SecuritySessionInfo>> => {
    try {
      return { success: true, data: await sessionInfo(assertConnectionId(rawConnectionId)) }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('server:security:guard-preview', async (_event, rawConnectionId: unknown, rawRequest: unknown): Promise<ServerResult<GuardPreview>> => {
    try {
      const connectionId = assertConnectionId(rawConnectionId)
      const request = validateGuardRequest(rawRequest)
      const exec = ctx.execFor(connectionId)
      if (!exec) throw new Error('Not connected')
      const config = await verifiableConfig(connectionId)
      const { keyAuth } = await sessionKeyInfo(config)
      return { success: true, data: await previewGuard(exec, request, keyAuth, config.port) }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('server:security:guard-run', async (_event, rawConnectionId: unknown, rawSessionKey: unknown, rawRequest: unknown): Promise<ServerResult<{ runId: string }>> => {
    try {
      const connectionId = assertConnectionId(rawConnectionId)
      const sessionKey = assertSessionKey(rawSessionKey)
      const request = validateGuardRequest(rawRequest)
      if (isBusy(connectionId)) throw new Error('Another firewall or SSH change is still running on this server.')
      const exec = ctx.execFor(connectionId)
      if (!exec) throw new Error('Not connected')
      const config = await verifiableConfig(connectionId)
      const { keyAuth } = await sessionKeyInfo(config)
      const runId = randomBytes(8).toString('hex')
      const guard = new LockoutGuard({
        exec,
        login: freshLogin(config),
        keyAuth,
        configPort: config.port,
        connectionId,
        sessionKey,
        activity,
        newId: () => runId,
        onUpdate: (run) => {
          runs.set(connectionId, run)
          ctx.broadcast(GUARD_UPDATE, run)
        }
      })
      void guard.execute(request).catch(() => undefined)
      return { success: true, data: { runId } }
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('server:security:guard-current', (_event, rawConnectionId: unknown): ServerResult<GuardRun | null> => {
    try {
      return { success: true, data: runs.get(assertConnectionId(rawConnectionId)) ?? null }
    } catch (error) {
      return fail(error)
    }
  })
}
