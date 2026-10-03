import { ipcMain } from 'electron'
import {
  closeFeatureWindow,
  createAppWindow,
  focusFeatureWindow,
  onResourceOrphaned,
  setHeldResources,
  getHandoff
} from '../services/WindowManager'
import { isFeatureWindowRef, parseResource } from '../../src/types/windowResources'
import { disconnectConnection } from './ssh.ipc'
import { closeUnattachedShells, detachShells } from './terminal.ipc'
import { disconnectSQLSession } from './sql.ipc'

function releaseOrphan(resource: string): void {
  const parsed = parseResource(resource)
  if (!parsed) return
  if (parsed.kind === 'ssh') {
    disconnectConnection(parsed.id)
    return
  }
  disconnectSQLSession(parsed.id).catch((err: unknown) => {
    console.warn(`[window] Failed to close orphaned SQL session ${parsed.id}:`, err)
  })
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

export function registerWindowIPC(): void {
  onResourceOrphaned(releaseOrphan)

  ipcMain.handle('window:open', (_event, handoff?: unknown, resources?: unknown, feature?: unknown, shellIds?: unknown) => {
    if (isFeatureWindowRef(feature) && focusFeatureWindow(feature)) return
    const win = createAppWindow({
      handoff,
      resources: stringsOf(resources),
      feature: isFeatureWindowRef(feature) ? feature : undefined
    })
    const movingShells = detachShells(stringsOf(shellIds))
    if (movingShells.length > 0) win.webContents.once('destroyed', () => closeUnattachedShells(movingShells))
  })

  ipcMain.handle('window:focusFeature', (_event, ref: unknown) => isFeatureWindowRef(ref) && focusFeatureWindow(ref))

  ipcMain.handle('window:closeFeature', (_event, ref: unknown) => {
    if (isFeatureWindowRef(ref)) closeFeatureWindow(ref)
  })

  ipcMain.handle('window:getHandoff', (event) => getHandoff(event.sender.id))

  ipcMain.on('window:setHeldResources', (event, resources: unknown) => {
    if (!Array.isArray(resources)) return
    setHeldResources(event.sender.id, resources.filter((r): r is string => typeof r === 'string'))
  })
}
