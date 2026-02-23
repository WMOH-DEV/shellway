import { ipcMain, BrowserWindow } from 'electron'
import { SSHService, type SSHConnectionConfig } from '../services/SSHService'
import { getLogService, LogService } from '../services/LogService'
import { getClientKeyStore } from './clientkey.ipc'
import { getNotificationService } from '../services/NotificationService'
import { getHealthService } from './health.ipc'
import { getSettingsStore } from './settings.ipc'
import { cleanupSFTP, cleanupAllSFTP } from './sftp.ipc'

const sshService = new SSHService()

/**
 * Map the renderer's session-shaped config into the flat SSHConnectionConfig
 * that SSHService expects.
 *
 * The renderer sends: { host, port, username, auth: { initialMethod, password, ... }, proxy, overrides, ... }
 * SSHService expects: { host, port, username, authMethod, password, privateKeyPath, ..., proxy, ... }
 */
function mapToConnectionConfig(raw: any): SSHConnectionConfig {
  const globalSettings = getSettingsStore().getAll()
  const auth = raw.auth || {}
  const proxy = raw.proxy
  const sshOverrides = raw.overrides?.ssh
  const connOverrides = raw.overrides?.connection

  // Resolve clientKeyId to actual key data if present
  let resolvedPrivateKeyData = auth.privateKeyData
  let resolvedPassphrase = auth.passphrase
  let resolvedPrivateKeyPath = auth.privateKeyPath

  if (auth.clientKeyId && auth.clientKeyId !== 'browse') {
    try {
      const clientKeyStore = getClientKeyStore()
      const decrypted = clientKeyStore.getDecrypted(auth.clientKeyId)
      if (decrypted) {
        resolvedPrivateKeyData = decrypted.privateKey
        resolvedPassphrase = decrypted.passphrase ?? auth.passphrase
        resolvedPrivateKeyPath = undefined // Don't use file path when using managed key
        // Mark the key as used
        clientKeyStore.touchLastUsed(auth.clientKeyId)
      }
    } catch {
      // Fall through to regular key handling
    }
  }

  const config: SSHConnectionConfig = {
    host: raw.host,
    port: raw.port ?? 22,
    username: raw.username,
    sessionId: raw.sessionId,

    // Auth — flatten from auth object
    authMethod: auth.initialMethod ?? 'password',
    password: auth.password,
    privateKeyPath: resolvedPrivateKeyPath,
    privateKeyData: resolvedPrivateKeyData,
    passphrase: resolvedPassphrase,
    agentForward: auth.agentForward,
    kbdiAutoRespond: auth.kbdiAutoRespond,
    kbdiSavedResponses: auth.kbdiSavedResponses,
    gssapiDelegateCreds: auth.gssapiDelegateCreds,
    gssapiSPN: auth.gssapiSPN,

    // Connection options — session overrides → global settings → hardcoded fallback
    keepAliveInterval: sshOverrides?.keepAliveInterval ?? globalSettings.connectionKeepAliveInterval,
    keepAliveCountMax: sshOverrides?.keepAliveCountMax ?? 3,
    readyTimeout: sshOverrides?.connectionTimeout ?? globalSettings.connectionTimeout,
    compression: sshOverrides?.compression,
  }

  // Algorithm preferences from overrides
  if (sshOverrides?.preferredCiphers || sshOverrides?.preferredKex || sshOverrides?.preferredHmac || sshOverrides?.preferredHostKey) {
    config.algorithms = {
      cipher: sshOverrides.preferredCiphers,
      kex: sshOverrides.preferredKex,
      hmac: sshOverrides.preferredHmac,
      hostKey: sshOverrides.preferredHostKey,
    }
  }

  // Proxy — use session proxy, or connection override proxy
  if (proxy && proxy.type !== 'none') {
    config.proxy = proxy
  } else if (connOverrides?.proxyType && connOverrides.proxyType !== 'none') {
    config.proxy = {
      type: connOverrides.proxyType,
      host: connOverrides.proxyHost || '',
      port: connOverrides.proxyPort || 1080,
      requiresAuth: !!(connOverrides.proxyUsername),
      username: connOverrides.proxyUsername,
      password: connOverrides.proxyPassword,
    }
  }

  // Reconnection config — global settings as base, session overrides on top
  {
    const enabled = sshOverrides?.reconnectAttempts !== undefined
      ? sshOverrides.reconnectAttempts !== 0
      : globalSettings.reconnectionEnabled
    const maxAttempts = sshOverrides?.reconnectAttempts ?? globalSettings.reconnectionMaxAttempts
    const initialDelay = sshOverrides?.reconnectDelay ?? globalSettings.reconnectionInitialDelay
    const maxDelay = globalSettings.reconnectionMaxDelay
    const backoffMultiplier = globalSettings.reconnectionBackoffMultiplier
    const jitter = globalSettings.reconnectionJitter

    config.reconnection = {
      enabled,
      maxAttempts,
      initialDelay,
      maxDelay,
      backoffMultiplier,
      jitter,
      resetAfterSuccess: true,
    }
  }

  return config
}

/**
 * Register SSH connection IPC handlers.
 *
 * Channels:
 *   ssh:connect      → { success: boolean, error?: string }
 *   ssh:disconnect   → void
 *   ssh:status       → SSHConnectionStatus
 *   ssh:isConnected  → boolean
 *   ssh:reconnect-retry-now → void
 *   ssh:reconnect-pause     → void
 *   ssh:reconnect-resume    → void
 *   ssh:reconnect-cancel    → void
 *
 * Events sent to renderer:
 *   ssh:status-change        → (connectionId, status)
 *   ssh:error                → (connectionId, error)
 *   ssh:banner               → (connectionId, message)
 *   ssh:reconnect-attempt    → (connectionId, attempt, maxAttempts)
 *   ssh:reconnect-waiting    → (connectionId, delayMs, nextAttempt, nextRetryAt)
 *   ssh:reconnect-success    → (connectionId, attempt)
 *   ssh:reconnect-failed     → (connectionId, attempt, error)
 *   ssh:reconnect-exhausted  → (connectionId, totalAttempts)
 *   ssh:reconnect-paused     → (connectionId)
 *   ssh:reconnect-resumed    → (connectionId)
 *   ssh:kbdi-prompt          → (connectionId, prompt)
 */
export function registerSSHIPC(): void {
  const logService = getLogService()

  ipcMain.handle(
    'ssh:connect',
    async (event, connectionId: string, rawConfig: unknown) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender)

        // Map the renderer's session-shaped config to the flat SSHConnectionConfig
        const config = mapToConnectionConfig(rawConfig)

        // Create the connection first (without connecting) so we can attach
        // event listeners BEFORE the connect attempt. This prevents unhandled
        // EventEmitter errors if connect fails and ssh2 emits follow-up events.
        const conn = sshService.create(connectionId, config)

        // Forward status changes to renderer
        conn.on('status', (status) => {
          win?.webContents.send('ssh:status-change', connectionId, status)

          // Notify on unexpected disconnect
          if (status === 'disconnected') {
            const sessionName = config.host || connectionId
            getNotificationService()?.notifyDisconnect(sessionName)
          }
        })
        conn.on('error', (error) => {
          win?.webContents.send('ssh:error', connectionId, error)
        })
        conn.on('banner', (message) => {
          win?.webContents.send('ssh:banner', connectionId, message)
        })

        // Forward reconnection events to renderer
        conn.on('reconnect-attempt', (connId: string, attempt: number, maxAttempts: number) => {
          win?.webContents.send('ssh:reconnect-attempt', connId, attempt, maxAttempts)
        })
        conn.on('reconnect-waiting', (connId: string, delayMs: number, nextAttempt: number, nextRetryAt: number) => {
          win?.webContents.send('ssh:reconnect-waiting', connId, delayMs, nextAttempt, nextRetryAt)
        })
        conn.on('reconnect-success', (connId: string, attempt: number) => {
          // Reconnection creates a new SSH client, invalidating the old SFTP wrapper.
          // Clean up stale SFTP so the next sftp:open creates a fresh session.
          cleanupSFTP(connId)
          win?.webContents.send('ssh:reconnect-success', connId, attempt)
        })
        conn.on('reconnect-failed', (connId: string, attempt: number, error: string) => {
          win?.webContents.send('ssh:reconnect-failed', connId, attempt, error)
        })
        conn.on('reconnect-exhausted', (connId: string, totalAttempts: number) => {
          win?.webContents.send('ssh:reconnect-exhausted', connId, totalAttempts)
        })
        conn.on('reconnect-paused', (connId: string) => {
          win?.webContents.send('ssh:reconnect-paused', connId)
        })
        conn.on('reconnect-resumed', (connId: string) => {
          win?.webContents.send('ssh:reconnect-resumed', connId)
        })

        // Forward KBDI prompts to renderer
        conn.on('kbdi-prompt', (connId: string, prompt: unknown, respond: (responses: string[]) => void) => {
          if (!win) return

          const responseChannel = `ssh:kbdi-response:${connId}`
          const handler = (_e: Electron.IpcMainEvent, responses: string[]) => {
            ipcMain.removeListener(responseChannel, handler)
            respond(responses)
          }
          ipcMain.on(responseChannel, handler)
          win.webContents.send('ssh:kbdi-prompt', connId, prompt)
        })

        // Now attempt the connection
        await conn.connect()

        // Start health monitoring once connected
        getHealthService().startMonitoring(conn)

        return { success: true }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  ipcMain.handle('ssh:disconnect', (_event, connectionId: string) => {
    const conn = sshService.get(connectionId)
    if (conn) {
      LogService.disconnectedByUser(logService, conn.sessionId)
    }
    getHealthService().stopMonitoring(connectionId)
    cleanupSFTP(connectionId)
    sshService.disconnect(connectionId)
  })

  ipcMain.handle('ssh:isConnected', (_event, connectionId: string) => {
    return sshService.isConnected(connectionId)
  })

  ipcMain.handle('ssh:disconnectAll', () => {
    cleanupAllSFTP()
    sshService.disconnectAll()
  })

  // ── Reconnection control handlers ──

  ipcMain.handle('ssh:reconnect-retry-now', (_event, connectionId: string) => {
    const conn = sshService.get(connectionId)
    conn?.retryNow()
  })

  ipcMain.handle('ssh:reconnect-pause', (_event, connectionId: string) => {
    const conn = sshService.get(connectionId)
    conn?.pauseReconnection()
  })

  ipcMain.handle('ssh:reconnect-resume', (_event, connectionId: string) => {
    const conn = sshService.get(connectionId)
    conn?.resumeReconnection()
  })

  ipcMain.handle('ssh:reconnect-cancel', (_event, connectionId: string) => {
    const conn = sshService.get(connectionId)
    conn?.cancelReconnection()
  })
}

/** Get the SSH service singleton (for use by other IPC modules) */
export function getSSHService(): SSHService {
  return sshService
}
