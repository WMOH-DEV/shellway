import { useConnectionStore } from '@/stores/connectionStore'
import { getSQLConnectionState, useSQLStore, type SQLConnectionSlice } from '@/stores/sqlStore'
import type { ConnectionTab } from '@/types/session'
import { sqlResource, sshResource, type FeatureWindowRef } from '@/types/windowResources'
import { adoptShells, liveShellsFor, type TerminalShell } from '@/utils/terminalShells'

type SubTab = ConnectionTab['activeSubTab']

interface TabHandoff {
  tab: ConnectionTab
  sql?: SQLConnectionSlice
  shells?: TerminalShell[]
}

interface WindowHandoff {
  tabs: TabHandoff[]
  feature?: SubTab
}

let windowFeature: SubTab | null = null

export function featureWindowSubTab(): SubTab | null {
  return windowFeature
}

function tabResources(tab: ConnectionTab, sql: SQLConnectionSlice | undefined): string[] {
  const resources = tab.type === 'database' ? [] : [sshResource(tab.id)]
  if (sql?.sqlSessionId) resources.push(sqlResource(sql.sqlSessionId))
  return resources
}

export function heldResources(): string[] {
  const sqlConnections = useSQLStore.getState().connections
  const resources = new Set<string>()
  for (const tab of useConnectionStore.getState().tabs) {
    if (tab.type !== 'database') resources.add(sshResource(tab.id))
  }
  for (const slice of Object.values(sqlConnections)) {
    if (slice.sqlSessionId) resources.add(sqlResource(slice.sqlSessionId))
  }
  return [...resources].sort()
}

function portableSQLState(connectionId: string): SQLConnectionSlice | undefined {
  if (!useSQLStore.getState().connections[connectionId]) return undefined
  const slice = getSQLConnectionState(connectionId)
  return { ...slice, queryResult: null, isQueryLoading: false, runningQueries: [], activeTransfer: null }
}

function findTab(tabId: string): ConnectionTab | undefined {
  return useConnectionStore.getState().tabs.find((t) => t.id === tabId)
}

function removeTabFromThisWindow(tabId: string): void {
  useConnectionStore.getState().removeTab(tabId)
  useSQLStore.getState().removeConnection(tabId)
}

export async function moveTabToNewWindow(tabId: string): Promise<void> {
  const tab = findTab(tabId)
  if (!tab) return

  const sql = portableSQLState(tabId)
  const shells = liveShellsFor(tabId)
  const handoff: WindowHandoff = { tabs: [{ tab, sql, shells }] }
  await window.novadeck.window.open(handoff, tabResources(tab, sql), undefined, shellIdsOf(shells))
  removeTabFromThisWindow(tabId)
}

function shellIdsOf(shells: TerminalShell[]): string[] {
  return shells.map((shell) => shell.id)
}

function featureTab(tab: ConnectionTab, subTab: SubTab): ConnectionTab {
  return { ...tab, activeSubTab: subTab, runningSubTabs: [subTab], splitView: false, detachedSubTabs: undefined }
}

export async function openFeatureWindow(tabId: string, subTab: SubTab): Promise<void> {
  const tab = findTab(tabId)
  if (!tab) return

  const ref: FeatureWindowRef = { tabId, subTab }
  if (tab.detachedSubTabs?.includes(subTab)) {
    await window.novadeck.window.focusFeature(ref)
    return
  }

  const sql = subTab === 'sql' ? portableSQLState(tabId) : undefined
  const shells = subTab === 'terminal' ? liveShellsFor(tabId) : []
  const handoff: WindowHandoff = {
    tabs: [{ tab: featureTab(tab, subTab), sql, shells }],
    feature: subTab
  }
  await window.novadeck.window.open(handoff, tabResources(tab, sql), ref, shellIdsOf(shells))

  if (tab.type === 'database') {
    removeTabFromThisWindow(tabId)
    return
  }
  useConnectionStore.getState().updateTab(tabId, { detachedSubTabs: [...(tab.detachedSubTabs ?? []), subTab] })
}

export function focusFeatureWindow(tabId: string, subTab: SubTab): Promise<boolean> {
  return window.novadeck.window.focusFeature({ tabId, subTab })
}

export function closeFeatureWindow(tabId: string, subTab: SubTab): Promise<void> {
  return window.novadeck.window.closeFeature({ tabId, subTab })
}

export function reattachFeature({ tabId, subTab }: FeatureWindowRef): void {
  const detached = findTab(tabId)?.detachedSubTabs
  if (!detached?.includes(subTab as SubTab)) return
  useConnectionStore.getState().updateTab(tabId, { detachedSubTabs: detached.filter((s) => s !== subTab) })
}

export function openEmptyWindow(): Promise<void> {
  return window.novadeck.window.open()
}

function isWindowHandoff(value: unknown): value is WindowHandoff {
  return typeof value === 'object' && value !== null && Array.isArray((value as WindowHandoff).tabs)
}

async function withLiveStatus(tab: ConnectionTab): Promise<ConnectionTab> {
  if (tab.type === 'database') return tab
  const isConnected = await window.novadeck.ssh.isConnected(tab.id)
  return { ...tab, status: isConnected ? 'connected' : 'disconnected' }
}

const ADOPTED_MARKER = 'shellway:handoff-adopted'

function isReloadOfAdoptedWindow(): boolean {
  try {
    const adopted = sessionStorage.getItem(ADOPTED_MARKER) === '1'
    sessionStorage.setItem(ADOPTED_MARKER, '1')
    return adopted
  } catch {
    return false
  }
}

export async function adoptWindowHandoff(): Promise<void> {
  const handoff = await window.novadeck.window.getHandoff()
  if (!isWindowHandoff(handoff)) return

  const isReload = isReloadOfAdoptedWindow()
  windowFeature = handoff.feature ?? null
  for (const { tab, sql, shells } of handoff.tabs) {
    if (sql && !isReload) {
      useSQLStore.setState((state) => ({ connections: { ...state.connections, [tab.id]: sql } }))
    }
    if (shells && shells.length > 0) adoptShells(tab.id, shells)
    useConnectionStore.getState().addTab(isReload ? await withLiveStatus(tab) : tab)
  }
}
