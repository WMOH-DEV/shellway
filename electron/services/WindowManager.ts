import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { FeatureWindowRef } from '../../src/types/windowResources'

/**
 * A Shellway window is either a full workspace or a single feature of one
 * connection (e.g. just its SFTP browser). Connections live in the main
 * process and any window can show them, so the renderer reports which
 * connections it is "holding" and a connection is only torn down once no
 * window holds it any more.
 */

export interface AppWindowOptions {
  /** Opaque state the new window adopts on startup (e.g. a tab moved from another window) */
  handoff?: unknown
  /** Resources the new window holds from the moment it exists, so the sender can let go first */
  resources?: string[]
  /** Makes this a single-feature window */
  feature?: FeatureWindowRef
}

const WORKSPACE_SIZE = { width: 1400, height: 900, minWidth: 960, minHeight: 600 }
const FEATURE_SIZE = { width: 1100, height: 760, minWidth: 640, minHeight: 420 }

const handoffs = new Map<number, unknown>()
const holdings = new Map<number, Set<string>>()
const featureWindows = new Map<number, FeatureWindowRef>()
let releaseOrphan: (resource: string) => void = () => {}

export function onResourceOrphaned(handler: (resource: string) => void): void {
  releaseOrphan = handler
}

function isHeldAnywhere(resource: string): boolean {
  for (const held of holdings.values()) {
    if (held.has(resource)) return true
  }
  return false
}

function liveWindow(webContentsId: number): BrowserWindow | null {
  const win = BrowserWindow.getAllWindows().find((w) => isLive(w) && w.webContents.id === webContentsId)
  return win ?? null
}

export function windowHolding(resource: string): BrowserWindow | null {
  for (const [webContentsId, held] of holdings) {
    if (!held.has(resource)) continue
    const win = liveWindow(webContentsId)
    if (win) return win
  }
  return null
}

function featureWindow({ tabId, subTab }: FeatureWindowRef): BrowserWindow | null {
  for (const [webContentsId, feature] of featureWindows) {
    if (feature.tabId === tabId && feature.subTab === subTab) return liveWindow(webContentsId)
  }
  return null
}

export function focusFeatureWindow(ref: FeatureWindowRef): boolean {
  const win = featureWindow(ref)
  if (!win) return false
  if (win.isMinimized()) win.restore()
  win.focus()
  return true
}

export function closeFeatureWindow(ref: FeatureWindowRef): void {
  featureWindow(ref)?.close()
}

export function setHeldResources(webContentsId: number, resources: string[]): void {
  const previous = holdings.get(webContentsId) ?? new Set<string>()
  holdings.set(webContentsId, new Set(resources))
  for (const resource of previous) {
    if (!isHeldAnywhere(resource)) releaseOrphan(resource)
  }
}

export function getHandoff(webContentsId: number): unknown {
  return handoffs.get(webContentsId) ?? null
}

function isLive(win: BrowserWindow): boolean {
  return !win.isDestroyed() && !win.webContents.isDestroyed()
}

export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (isLive(win)) win.webContents.send(channel, ...args)
  }
}

function loadRenderer(win: BrowserWindow): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function cascadeFrom(win: BrowserWindow | null): { x?: number; y?: number } {
  if (!win || win.isDestroyed()) return {}
  const [x, y] = win.getPosition()
  return { x: x + 32, y: y + 32 }
}

export function createAppWindow(options: AppWindowOptions = {}): BrowserWindow {
  const win = new BrowserWindow({
    ...(options.feature ? FEATURE_SIZE : WORKSPACE_SIZE),
    ...cascadeFrom(BrowserWindow.getFocusedWindow()),
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f1117',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const webContentsId = win.webContents.id
  if (options.handoff !== undefined) handoffs.set(webContentsId, options.handoff)
  holdings.set(webContentsId, new Set(options.resources ?? []))
  if (options.feature) featureWindows.set(webContentsId, options.feature)

  win.on('ready-to-show', () => win.show())
  win.on('maximize', () => win.webContents.send('window:maximized-change', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized-change', false))
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  win.webContents.on('destroyed', () => {
    handoffs.delete(webContentsId)
    setHeldResources(webContentsId, [])
    holdings.delete(webContentsId)
    const feature = featureWindows.get(webContentsId)
    featureWindows.delete(webContentsId)
    if (feature) broadcast('window:featureClosed', feature)
  })

  loadRenderer(win)
  return win
}
