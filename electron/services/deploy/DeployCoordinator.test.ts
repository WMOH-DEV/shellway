import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { DeployRecord } from '../../../src/types/deploy'
import { DeployCoordinator, type CoordinatorDeps } from './DeployCoordinator'
import { DeployService } from './DeployService'
import { LocalGit } from './LocalGit'
import type { RemoteExec } from './DeployService'
import { SITE_USERS_SCRIPT } from './siteUser'
import { fakeCrontab, git, localExec, makeSite } from './testFixtures'

let base: string
let origin: string
let work: string
let exec: ReturnType<typeof localExec>
let connected: boolean
let seen: Map<string, number>
let deps: CoordinatorDeps & { notify: ReturnType<typeof vi.fn>; broadcast: ReturnType<typeof vi.fn> }
let coordinator: DeployCoordinator

function commit(content: string): string {
  writeFileSync(join(work, 'index.html'), content)
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', content)
  git(work, 'push', '-q', 'origin', 'main')
  return git(work, 'rev-parse', 'HEAD')
}

const site = (overrides = {}) => makeSite({
  name: 'app', path: join(base, 'www', 'app'), repoUrl: origin, sharedPaths: [], healthUrl: '', buildSteps: [], activateSteps: [], ...overrides
})

async function finishedRecord(): Promise<DeployRecord> {
  await vi.waitFor(() => expect(deps.broadcast).toHaveBeenCalledWith('deploy:finished', 'c1', 'app', expect.anything()), { timeout: 10_000 })
  return deps.broadcast.mock.calls.find((c) => c[0] === 'deploy:finished')![3]
}

describe.skipIf(process.platform === 'win32')('DeployCoordinator', () => {
  beforeEach(async () => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'sw-coord-')))
    origin = join(base, 'origin.git')
    work = join(base, 'work')
    mkdirSync(join(base, 'home'))
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
    execFileSync('git', ['init', '-q', '-b', 'main', work])
    git(work, 'remote', 'add', 'origin', origin)
    commit('v1')
    exec = localExec({ ...process.env, HOME: join(base, 'home'), SHELLWAY_CRONTAB: fakeCrontab(base).bin, SHELLWAY_CRON_PROCESSES: 'node' })
    connected = true
    seen = new Map()
    deps = {
      execFor: () => (connected ? exec : null),
      local: {
        usesDeploy: () => true,
        markUsesDeploy: vi.fn(),
        lastSeen: (s, n) => seen.get(`${s}:${n}`) ?? 0,
        setLastSeen: (s, n, t) => { seen.set(`${s}:${n}`, t) }
      },
      git: new LocalGit(join(base, 'pc-cache'), { allowLocalRepos: true }),
      notify: vi.fn(),
      broadcast: vi.fn(),
      trackIntervalMs: 100
    }
    coordinator = new DeployCoordinator(deps)
    await new DeployService(exec).installRunner()
  })

  afterEach(() => rmSync(base, { recursive: true, force: true }))

  it('starts a manual deploy, tracks it and reports the outcome', async () => {
    await new DeployService(exec).saveSite(site())
    const id = await coordinator.deploy('c1', 'app')
    const record = await finishedRecord()
    expect(record).toMatchObject({ id, status: 'success' })
    expect(deps.notify).toHaveBeenCalledWith('Deploy finished', 'app')
    expect(readFileSync(join(base, 'www', 'app', 'index.html'), 'utf8')).toBe('v1')
  })

  it('deploys the previewed commit and skips the migration pause once it was reviewed', async () => {
    await new DeployService(exec).saveSite(site({ approveMigrations: true }))
    await coordinator.deploy('c1', 'app')
    await finishedRecord()
    deps.broadcast.mockClear()
    mkdirSync(join(work, 'database', 'migrations'), { recursive: true })
    writeFileSync(join(work, 'database', 'migrations', '2026_add.php'), '<?php')
    const reviewed = commit('v2')
    commit('v3')
    const id = await coordinator.deploy('c1', 'app', { commit: reviewed, approved: true })
    expect(await finishedRecord()).toMatchObject({ id, status: 'success', commit: reviewed })
    expect(readFileSync(join(base, 'www', 'app', 'index.html'), 'utf8')).toBe('v2')
  })

  it('cancels a running deploy and reports it as cancelled', async () => {
    const service = new DeployService(exec)
    await service.saveSite(site({ buildSteps: [{ command: 'sleep 41', optional: false, timeoutSeconds: null }] }))
    const id = await coordinator.deploy('c1', 'app')
    await vi.waitFor(async () => {
      const [summary] = await service.listSites()
      expect(summary.state.progress?.command).toBe('sleep 41')
    }, { timeout: 10_000 })
    await coordinator.cancel('c1', 'app')
    const record = await finishedRecord()
    expect(record).toMatchObject({ id, status: 'cancelled' })
    expect(deps.notify).toHaveBeenCalledWith('Deploy cancelled', 'app: cancelled; live site untouched')
  })

  it('refuses to start while the site is busy', async () => {
    await new DeployService(exec).saveSite(site())
    mkdirSync(join(base, 'home', '.shellway-deploy', 'sites', 'app', 'lock'))
    writeFileSync(join(base, 'home', '.shellway-deploy', 'sites', 'app', 'lock', 'pid'), String(process.pid))
    await expect(coordinator.deploy('c1', 'app')).rejects.toThrow(/already running/)
  })

  it('auto deploys new commits from the PC once per head', async () => {
    await new DeployService(exec).saveSite(site({ sourceMode: 'pc', pcAuto: true }))
    await coordinator.list('c1', 's1')
    await coordinator.watchOnce()
    expect((await finishedRecord()).trigger).toBe('pc')
    deps.broadcast.mockClear()
    await coordinator.list('c1', 's1')
    await coordinator.watchOnce()
    expect(deps.broadcast).not.toHaveBeenCalledWith('deploy:changed', 'c1')
  })

  it('tries a new PC head only once even when the deploy could not start', async () => {
    await new DeployService(exec).saveSite(site({ sourceMode: 'pc', pcAuto: true }))
    const fetch = vi.spyOn(deps.git, 'fetch').mockRejectedValue(new Error('network down'))
    for (let i = 0; i < 3; i++) {
      await coordinator.list('c1', 's1')
      await coordinator.watchOnce()
    }
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(deps.notify).toHaveBeenCalledTimes(1)
  })

  it('does nothing for pc sites without auto deploy or when disconnected', async () => {
    await new DeployService(exec).saveSite(site({ sourceMode: 'pc', pcAuto: false }))
    await coordinator.list('c1', 's1')
    await coordinator.watchOnce()
    connected = false
    await coordinator.watchOnce()
    expect(deps.broadcast).not.toHaveBeenCalled()
  })

  it('summarises deploys that finished while the app was closed, once', async () => {
    await new DeployService(exec).saveSite(site())
    await coordinator.deploy('c1', 'app')
    await finishedRecord()
    seen.clear()
    await coordinator.onConnected('c1', 's1', 'server-a')
    expect(deps.notify).toHaveBeenLastCalledWith('Deploys on server-a while you were away', 'app: 1 deploy')
    deps.notify.mockClear()
    await coordinator.onConnected('c1', 's1', 'server-a')
    expect(deps.notify).not.toHaveBeenCalled()
  })

  it('resumes the auto check and tells the window to refresh', async () => {
    await new DeployService(exec).saveSite(site())
    writeFileSync(join(base, 'home', '.shellway-deploy', 'sites', 'app', 'check_failures'), '4')
    await coordinator.resume('c1', 'app')
    expect(readFileSync(join(base, 'home', '.shellway-deploy', 'sites', 'app', 'remote_head'), 'utf8').trim()).toBe(git(work, 'rev-parse', 'HEAD'))
    expect(deps.broadcast).toHaveBeenCalledWith('deploy:changed', 'c1')
  })

  it('passes on why the auto check could not resume', async () => {
    await new DeployService(exec).saveSite(site({ repoUrl: join(base, 'missing.git') }))
    await expect(coordinator.resume('c1', 'app')).rejects.toThrow(/missing\.git/)
  })

  describe('previewing a deploy', () => {
    it.each(['auto', 'pc'] as const)('lists the commits waiting to ship for a %s site', async (sourceMode) => {
      await new DeployService(exec).saveSite(site({ sourceMode }))
      await coordinator.deploy('c1', 'app')
      await finishedRecord()
      const live = git(work, 'rev-parse', 'HEAD')
      const head = commit('v2')
      const preview = await coordinator.preview('c1', 'app')
      expect(preview).toMatchObject({ from: live, to: head, branch: 'main', totalCommits: 1, totalFiles: 1 })
      expect(preview.commits[0]).toMatchObject({ sha: head, subject: 'v2' })
      expect(preview.files[0]).toMatchObject({ status: 'M', path: 'index.html' })
    })

    it('rejects an unknown site', async () => {
      await expect(coordinator.preview('c1', 'nope')).rejects.toThrow(/Unknown site/)
    })
  })
})

const SUDO_AS = /^sudo -n -u (\S+) -H -- sh -c ([\s\S]*)$/

describe.skipIf(process.platform === 'win32')('DeployCoordinator logged in as root', () => {
  let userExec: RemoteExec
  let sudoUsers: string[]

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'sw-coord-root-')))
    origin = join(base, 'origin.git')
    work = join(base, 'work')
    mkdirSync(join(base, 'root-home'))
    mkdirSync(join(base, 'deploy-home'))
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
    execFileSync('git', ['init', '-q', '-b', 'main', work])
    git(work, 'remote', 'add', 'origin', origin)
    commit('v1')
    const env = { ...process.env, SHELLWAY_CRONTAB: fakeCrontab(base).bin, SHELLWAY_CRON_PROCESSES: 'node' }
    const rootExec = localExec({ ...env, HOME: join(base, 'root-home') })
    userExec = localExec({ ...env, HOME: join(base, 'deploy-home') })
    sudoUsers = []
    const asRoot: RemoteExec = async (command, options) => {
      if (options?.stdin === SITE_USERS_SCRIPT) return { stdout: 'deploy 1\nubuntu 0\n', stdoutBytes: 22, stderr: '', code: 0 }
      const sudo = SUDO_AS.exec(command)
      if (!sudo) return rootExec(command, options)
      sudoUsers.push(sudo[1])
      return userExec(`sh -c ${sudo[2]}`, options)
    }
    deps = {
      execFor: () => asRoot,
      local: { usesDeploy: () => true, markUsesDeploy: vi.fn(), lastSeen: () => 0, setLastSeen: vi.fn() },
      git: new LocalGit(join(base, 'pc-cache'), { allowLocalRepos: true }),
      notify: vi.fn(),
      broadcast: vi.fn(),
      trackIntervalMs: 100
    }
    coordinator = new DeployCoordinator(deps)
  })

  afterEach(() => rmSync(base, { recursive: true, force: true }))

  it('lists the sites of other users and deploys them as their user', async () => {
    const asDeploy = new DeployService(userExec)
    await asDeploy.installRunner()
    await asDeploy.saveSite(site())
    expect(await coordinator.runnerInfo('c1')).toMatchObject({ installed: true })
    const [listed] = await coordinator.list('c1', 's1')
    expect(listed).toMatchObject({ user: 'deploy', config: { name: 'app' } })
    sudoUsers = []
    const id = await coordinator.deploy('c1', 'app')
    expect(await finishedRecord()).toMatchObject({ id, status: 'success' })
    expect(sudoUsers.length).toBeGreaterThan(0)
    expect(new Set(sudoUsers)).toEqual(new Set(['deploy']))
  })

  it('updates the runner of every user that has one, and leaves root without one', async () => {
    await new DeployService(userExec).installRunner()
    await coordinator.installRunner('c1')
    expect(await new DeployService(deps.execFor('c1')!).runnerInfo()).toMatchObject({ installed: false })
    expect(await new DeployService(userExec).runnerInfo()).toMatchObject({ installed: true })
  })

  it('adds a new site to root\'s own runner, installing it first, and lists it next to the other users\' sites', async () => {
    const asDeploy = new DeployService(userExec)
    await asDeploy.installRunner()
    await asDeploy.saveSite(site())
    await coordinator.saveSite('c1', { ...site(), name: 'rootapp', path: join(base, 'rootapp') })
    const listed = (await coordinator.list('c1', 's1')).map((summary) => [summary.config.name, summary.user])
    expect(listed).toEqual(expect.arrayContaining([['app', 'deploy'], ['rootapp', null]]))
  })
})
