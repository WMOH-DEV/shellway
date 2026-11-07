import { ipcRenderer } from 'electron'
import type { ActionPlanView, ActionRun, ActivityEntry, ActivityQuery, RunOutputChunk, RunStartResult, ServerFacts, ServerResult } from '../../../src/types/server/core'
import { activityApi } from './activity'
import { databasesApi } from './databases'
import { dockerApi } from './docker'
import { jobsApi } from './jobs'
import { overviewApi } from './overview'
import { securityApi } from './security'
import { servicesApi } from './services'
import { settingsApi } from './settings'
import { setupApi } from './setup'
import { sitesApi } from './sites'
import { softwareApi } from './software'

function listen<A extends unknown[]>(channel: string, callback: (...args: A) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...(args as A))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

export const serverApi = {
  scan: (connectionId: string, probeIds: string[] | null, force: boolean) =>
    ipcRenderer.invoke('server:scan', connectionId, probeIds, force) as Promise<ServerResult<ServerFacts>>,
  facts: (connectionId: string) => ipcRenderer.invoke('server:facts', connectionId) as Promise<ServerResult<ServerFacts>>,
  plan: (connectionId: string, type: string, params: unknown) =>
    ipcRenderer.invoke('server:plan', connectionId, type, params) as Promise<ServerResult<ActionPlanView>>,
  run: (connectionId: string, sessionKey: string, planId: string) =>
    ipcRenderer.invoke('server:run', connectionId, sessionKey, planId) as Promise<ServerResult<RunStartResult>>,
  stop: (runId: string) => ipcRenderer.invoke('server:stop', runId) as Promise<ServerResult>,
  runs: (connectionId: string) => ipcRenderer.invoke('server:runs', connectionId) as Promise<ServerResult<ActionRun[]>>,
  activity: (sessionKey: string, query: ActivityQuery) =>
    ipcRenderer.invoke('server:activity', sessionKey, query) as Promise<ServerResult<ActivityEntry[]>>,
  onRun: (callback: (run: ActionRun) => void) => listen<[ActionRun]>('server:run-update', callback),
  onOutput: (callback: (output: RunOutputChunk) => void) => listen<[RunOutputChunk]>('server:run-output', callback),
  onFacts: (callback: (connectionId: string, facts: ServerFacts) => void) => listen<[string, ServerFacts]>('server:facts', callback),
  overview: overviewApi,
  sites: sitesApi,
  software: softwareApi,
  services: servicesApi,
  docker: dockerApi,
  databases: databasesApi,
  jobs: jobsApi,
  security: securityApi,
  activityArea: activityApi,
  settings: settingsApi,
  setup: setupApi
}
