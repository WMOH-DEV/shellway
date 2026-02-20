import { ipcMain } from 'electron'
import { ClientKeyStore } from '../services/ClientKeyStore'

const clientKeyStore = new ClientKeyStore()

/**
 * Register client key management IPC handlers.
 *
 * Channels:
 *   clientkey:getAll       → ClientKeyInfo[]
 *   clientkey:importFile   → ClientKeyInfo  (import from file path)
 *   clientkey:importData   → ClientKeyInfo  (import from pasted PEM data)
 *   clientkey:remove       → boolean
 *   clientkey:update       → boolean
 *   clientkey:getPublicKey → string (public key for a given ID)
 */
export function registerClientKeyIPC(): void {
  ipcMain.handle('clientkey:getAll', () => {
    return clientKeyStore.getAllInfo()
  })

  ipcMain.handle(
    'clientkey:importFile',
    async (
      _event,
      filePath: string,
      name: string,
      passphrase?: string,
      savePassphrase?: boolean
    ) => {
      try {
        const info = clientKeyStore.importFromFile(filePath, name, passphrase, savePassphrase)
        return { success: true, data: info }
      } catch (err) {
        return { success: false, error: String(err instanceof Error ? err.message : err) }
      }
    }
  )

  ipcMain.handle(
    'clientkey:importData',
    async (
      _event,
      privateKeyData: string,
      name: string,
      passphrase?: string,
      savePassphrase?: boolean
    ) => {
      try {
        const info = clientKeyStore.importFromData(privateKeyData, name, passphrase, savePassphrase)
        return { success: true, data: info }
      } catch (err) {
        return { success: false, error: String(err instanceof Error ? err.message : err) }
      }
    }
  )

  ipcMain.handle('clientkey:remove', (_event, id: string) => {
    return clientKeyStore.remove(id)
  })

  ipcMain.handle('clientkey:update', (_event, id: string, updates: { name?: string; comment?: string }) => {
    return clientKeyStore.update(id, updates)
  })

  ipcMain.handle('clientkey:getPublicKey', (_event, id: string) => {
    const keys = clientKeyStore.getAllInfo()
    const key = keys.find((k) => k.id === id)
    return key?.publicKey || null
  })
}

/** Get the ClientKeyStore singleton (for use by SSHService) */
export function getClientKeyStore(): ClientKeyStore {
  return clientKeyStore
}
