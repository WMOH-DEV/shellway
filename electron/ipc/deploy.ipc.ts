import { app, ipcMain } from 'electron'
import { join } from 'path'
import { getSSHService } from './ssh.ipc'
import { broadcast } from '../services/WindowManager'
import { getNotificationService } from '../services/NotificationService'
import { sshExec } from '../utils/sshExec'
import { DeployCoordinator } from '../services/deploy/DeployCoordinator'
import { withServerNotify } from '../services/serverNotify/notifyEvents'
import { DeployLocalStore } from '../services/deploy/DeployLocalStore'
import { LocalGit } from '../services/deploy/LocalGit'
import type { RemoteExec } from '../services/deploy/DeployService'
import { registerDeployKey } from '../services/deploy/githubDeployKey'
import { readWebServerCheck } from '../services/deploy/webServerCheck'
import { parseGitHubRepo } from '../../src/utils/deploy/githubRepo'
import type { DeployOptions, DeployResult, SiteConfig } from '../../src/types/deploy'

let coordinator: DeployCoordinator | null = null
let localStore: DeployLocalStore | null = null
let localGit: LocalGit | null = null

function execFor(connectionId: string): RemoteExec | null {
  const conn = getSSHService().get(connectionId)
  if (!conn || conn.status !== 'connected') return null
  return (command, options) => sshExec(conn, command, options)
}

function str(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw new Error(`Invalid ${label}`)
  return value
}

const COMMIT_SHA = /^[0-9a-f]{7,64}$/

function deployOptions(value: unknown): DeployOptions {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null) throw new Error('Invalid deploy options')
  const { commit, approved } = value as Record<string, unknown>
  if (commit !== undefined && (typeof commit !== 'string' || !COMMIT_SHA.test(commit))) throw new Error('Invalid commit')
  if (approved !== undefined && typeof approved !== 'boolean') throw new Error('Invalid deploy options')
  return { commit: commit as string | undefined, approved: approved as boolean | undefined }
}

function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<DeployResult<unknown>> => {
    try {
      return { success: true, data: await fn(...args) }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}

export function requireCoordinator(): DeployCoordinator {
  if (!coordinator) throw new Error('Deploy service is not ready')
  return coordinator
}

async function webServerCheck(connectionId: string, name: string) {
  const exec = execFor(connectionId)
  if (!exec) throw new Error('Not connected')
  const site = (await requireCoordinator().service(connectionId).listSites()).find((s) => s.config.name === name)
  if (!site) throw new Error(`Unknown site ${name}`)
  return readWebServerCheck(exec, site.config.path)
}

async function registerKey(connectionId: string, name: string, token: string | null, remember: boolean): Promise<{ alreadyAdded: boolean }> {
  const service = requireCoordinator().service(connectionId)
  const site = (await service.listSites()).find((s) => s.config.name === name)
  if (!site) throw new Error(`Unknown site ${name}`)
  const repo = parseGitHubRepo(site.config.repoUrl)
  if (!repo) throw new Error('Automatic key setup only works for GitHub repositories')
  const useToken = token ?? localStore!.githubToken()
  if (!useToken) throw new Error('A GitHub token is needed')
  const publicKey = await service.keygen(name)
  const result = await registerDeployKey(useToken, repo, `Shellway deploy: ${name}`, publicKey)
  if (token && remember) localStore!.setGithubToken(token)
  return result
}

export function registerDeployIPC(): void {
  localStore = new DeployLocalStore()
  localGit = new LocalGit(join(app.getPath('userData'), 'deploy-cache'))
  coordinator = new DeployCoordinator({
    execFor,
    local: localStore,
    git: localGit,
    notify: (title, body) => getNotificationService()?.notifyDeploy({ title, body }),
    broadcast: withServerNotify(broadcast)
  })
  coordinator.startWatching()

  const service = (connectionId: unknown) => requireCoordinator().service(str(connectionId, 'connection'))

  handle('deploy:runner-info', (c) => service(c).runnerInfo())
  handle('deploy:install-runner', (c) => service(c).installRunner())
  handle('deploy:list', (c, s) => requireCoordinator().list(str(c, 'connection'), str(s, 'session')))
  handle('deploy:save', (c, config) => service(c).saveSite(config as SiteConfig))
  handle('deploy:remove', (c, name) => service(c).removeSite(str(name, 'site')))
  handle('deploy:deploy', (c, name, options) => requireCoordinator().deploy(str(c, 'connection'), str(name, 'site'), deployOptions(options)))
  handle('deploy:preview', (c, name) => requireCoordinator().preview(str(c, 'connection'), str(name, 'site')))
  handle('deploy:rollback',(c, name, target) => requireCoordinator().rollback(str(c, 'connection'), str(name, 'site'), str(target, 'deploy')))
  handle('deploy:approve', (c, name) => requireCoordinator().approve(str(c, 'connection'), str(name, 'site')))
  handle('deploy:cancel', (c, name) => requireCoordinator().cancel(str(c, 'connection'), str(name, 'site')))
  handle('deploy:resume', (c, name) => requireCoordinator().resume(str(c, 'connection'), str(name, 'site')))
  handle('deploy:apply', (c, name) => requireCoordinator().apply(str(c, 'connection'), str(name, 'site')))
  handle('deploy:log', (c, name, id, offset) => service(c).readLog(str(name, 'site'), str(id, 'deploy'), typeof offset === 'number' ? offset : 0))
  handle('deploy:doctor', (c, name) => service(c).doctor(str(name, 'site')))
  handle('deploy:web-check', (c, name) => webServerCheck(str(c, 'connection'), str(name, 'site')))
  handle('deploy:keygen', (c, name) => service(c).keygen(str(name, 'site')))
  handle('deploy:check-remote', (c, name) => service(c).checkRemote(str(name, 'site')))
  handle('deploy:env-read', (c, name) => service(c).readEnv(str(name, 'site')))
  handle('deploy:env-write', (c, name, content) => {
    if (typeof content !== 'string') throw new Error('Invalid content')
    return service(c).writeEnv(str(name, 'site'), content)
  })
  handle('deploy:detect', (c, path) => service(c).detect(str(path, 'path')))
  handle('deploy:register-key', (c, name, token, remember) =>
    registerKey(str(c, 'connection'), str(name, 'site'), typeof token === 'string' && token ? token : null, remember === true))
  handle('deploy:github-token-saved', () => localStore!.githubToken() !== null)
  handle('deploy:github-token-clear', () => localStore!.setGithubToken(null))
  handle('deploy:local-git', () => localGit!.available())
  handle('deploy:drift', (url, branch, live) => localGit!.drift(str(url, 'repository'), str(branch, 'branch'), typeof live === 'string' ? live : ''))
}

export function notifyDeployConnectionReady(connectionId: string, sessionId: string | undefined, label: string): void {
  if (!coordinator || !sessionId) return
  void coordinator.onConnected(connectionId, sessionId, label)
}

export function notifyDeployConnectionClosed(connectionId: string): void {
  coordinator?.forget(connectionId)
}
