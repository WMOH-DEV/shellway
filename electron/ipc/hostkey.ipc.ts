import { ipcMain, BrowserWindow } from 'electron'
import { HostKeyStore } from '../services/HostKeyStore'

const hostKeyStore = new HostKeyStore()

/**
 * Register host key management IPC handlers.
 *
 * Channels:
 *   hostkey:getAll → TrustedHostKey[]
 *   hostkey:remove(id) → void
 *   hostkey:removeAllForHost(host, port) → void
 *   hostkey:updateComment(id, comment) → void
 *   hostkey:export → string (known_hosts format)
 *   hostkey:import(content) → number (imported count)
 *
 * Events:
 *   hostkey:verify-request → sent to renderer when a new/changed key needs user decision
 *   hostkey:verify-response → received from renderer with user's decision
 */
export function registerHostKeyIPC(): void {
  ipcMain.handle('hostkey:getAll', () => {
    return hostKeyStore.getAll()
  })

  ipcMain.handle('hostkey:remove', (_event, id: string) => {
    hostKeyStore.remove(id)
  })

  ipcMain.handle('hostkey:removeAllForHost', (_event, host: string, port: number) => {
    return hostKeyStore.removeAllForHost(host, port)
  })

  ipcMain.handle('hostkey:updateComment', (_event, id: string, comment: string) => {
    hostKeyStore.updateComment(id, comment)
  })

  ipcMain.handle('hostkey:export', () => {
    return hostKeyStore.exportKnownHosts()
  })

  ipcMain.handle('hostkey:import', (_event, content: string) => {
    return hostKeyStore.importKnownHosts(content)
  })
}

/** Get the HostKeyStore singleton (for use by SSHService) */
export function getHostKeyStore(): HostKeyStore {
  return hostKeyStore
}

/**
 * Send a host key verification request to the renderer.
 * Returns a promise that resolves with the user's decision.
 */
export function requestHostKeyVerification(
  win: BrowserWindow,
  connectionId: string,
  info: {
    host: string
    port: number
    keyType: string
    fingerprint: string
    publicKeyBase64: string
    status: 'new' | 'changed'
    previousFingerprint?: string
    previousTrustedAt?: number
  }
): Promise<{ action: 'trust-once' | 'trust-save' | 'accept-new' | 'disconnect' }> {
  return new Promise((resolve) => {
    const channel = `hostkey:verify-response:${connectionId}`

    const handler = (
      _event: Electron.IpcMainEvent,
      response: { action: 'trust-once' | 'trust-save' | 'accept-new' | 'disconnect' }
    ) => {
      ipcMain.removeListener(channel, handler)
      resolve(response)
    }

    ipcMain.on(channel, handler)
    win.webContents.send('hostkey:verify-request', connectionId, info)
  })
}
