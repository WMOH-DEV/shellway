import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { createReadStream, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, realpathSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DeployService, newDeployId, type RemoteExec } from './DeployService'
import { fakeCrontab, git, localExec, makeSite, waitForDeploy } from './testFixtures'

let base: string
let home: string
let origin: string
let work: string
let crontabFile: string
let service: DeployService

describe.skipIf(process.platform === 'win32')('DeployService against the real runner', () => {
  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'sw-svc-')))
    home = join(base, 'home')
    origin = join(base, 'origin.git')
    work = join(base, 'work')
    const crontab = fakeCrontab(base)
    crontabFile = crontab.file
    mkdirSync(home)
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
    execFileSync('git', ['init', '-q', '-b', 'main', work])
    git(work, 'remote', 'add', 'origin', origin)
    writeFileSync(join(work, 'index.html'), 'v1')
    git(work, 'add', '-A')
    git(work, 'commit', '-q', '-m', 'first')
    git(work, 'push', '-q', 'origin', 'main')
    service = new DeployService(localExec({ ...process.env, HOME: home, SHELLWAY_CRONTAB: crontab.bin, SHELLWAY_HEALTH_DELAY: '0' }))
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  const site = (overrides = {}) => makeSite({
    name: 'app',
    path: join(base, 'www', 'app'),
    repoUrl: origin,
    sharedPaths: ['.env'],
    healthUrl: '',
    buildSteps: [{ command: 'echo built', optional: false, timeoutSeconds: null }],
    activateSteps: [],
    ...overrides
  })

  it('reports the runner as missing until it is installed', async () => {
    expect((await service.runnerInfo()).installed).toBe(false)
    await service.installRunner()
    const info = await service.runnerInfo()
    expect(info).toEqual({ installed: true, version: DeployService.bundledVersion, bundledVersion: DeployService.bundledVersion })
    expect(DeployService.bundledVersion).toBeGreaterThan(0)
  })

  it('saves a site, lists it back and installs the schedule for auto sites', async () => {
    await service.installRunner()
    await service.saveSite(site())
    const [listed] = await service.listSites()
    expect(listed.config).toEqual(site())
    expect(readFileSync(crontabFile, 'utf8')).toContain('# shellway-deploy')
  })

  it('rejects an invalid site before touching the server', async () => {
    const exec = vi.fn<RemoteExec>()
    await expect(new DeployService(exec).saveSite(site({ name: '../evil' }))).rejects.toThrow(/Name/)
    expect(exec).not.toHaveBeenCalled()
  })

  it('runs a detached deploy and streams its log', async () => {
    await service.installRunner()
    await service.saveSite(site())
    const id = newDeployId()
    await service.startDeploy('app', id)
    expect(await waitForDeploy(service, 'app', id)).toBe('success')
    const first = await service.readLog('app', id, 0)
    expect(first.text).toContain('$ echo built')
    expect(first.text).toContain('deploy success')
    const rest = await service.readLog('app', id, first.offset)
    expect(rest).toEqual({ text: '', offset: first.offset })
  })

  it('deploys code uploaded as a bundle for from-pc sites', async () => {
    await service.installRunner()
    await service.saveSite(site({ sourceMode: 'pc', repoUrl: 'git@example.invalid:o/r.git' }))
    const bundle = join(base, 'code.bundle')
    git(work, 'bundle', 'create', bundle, 'refs/heads/main')
    await service.uploadBundle('app', createReadStream(bundle))
    const id = newDeployId()
    await service.startDeploy('app', id, ['--uploaded-bundle', '--trigger', 'pc'])
    expect(await waitForDeploy(service, 'app', id)).toBe('success')
    expect(readFileSync(join(base, 'www', 'app', 'index.html'), 'utf8')).toBe('v1')
  })

  it('reads and writes the shared env file, keeping backups out of the site folder', async () => {
    await service.installRunner()
    await service.saveSite(site())
    const missing = await service.readEnv('app')
    expect(missing).toEqual({ exists: false, content: '', path: join(base, 'www', 'app-deploy', 'shared', '.env') })
    await service.writeEnv('app', 'A=1\n')
    await service.writeEnv('app', 'A=2\n')
    expect(await service.readEnv('app')).toMatchObject({ exists: true, content: 'A=2\n' })
    expect(readdirSync(join(base, 'www', 'app-deploy', 'shared'))).toEqual(['.env'])
    const backupDir = join(home, '.shellway-deploy', 'sites', 'app', 'env-backups')
    expect(readdirSync(backupDir)).toHaveLength(1)
    expect(statSync(backupDir).mode & 0o777).toBe(0o700)
  })

  it('keeps only the newest ten env backups', async () => {
    await service.installRunner()
    await service.saveSite(site())
    for (let i = 0; i < 13; i++) await service.writeEnv('app', `A=${i}\n`)
    expect(readdirSync(join(home, '.shellway-deploy', 'sites', 'app', 'env-backups'))).toHaveLength(10)
  })

  it('detects the repository, branch and files of an existing folder', async () => {
    writeFileSync(join(work, 'package.json'), '{ "scripts": { "build": "vite build" } }')
    const found = await service.detect(work)
    expect(found).toMatchObject({ exists: true, repoUrl: origin, branch: 'main', buildScript: true })
    expect(found.files).toEqual(expect.arrayContaining(['index.html', 'package.json', '.git']))
    expect((await service.detect(join(base, 'nope'))).exists).toBe(false)
  })

  it('removes a site and its schedule but leaves the deployed code', async () => {
    await service.installRunner()
    await service.saveSite(site())
    const id = newDeployId()
    await service.startDeploy('app', id)
    await waitForDeploy(service, 'app', id)
    await service.removeSite('app')
    expect(await service.listSites()).toEqual([])
    expect(readFileSync(crontabFile, 'utf8')).not.toContain('shellway-deploy')
    expect(existsSync(join(base, 'www', 'app', 'index.html'))).toBe(true)
  })

  it('refuses ids and names that are not safe to put in a command', async () => {
    const exec = vi.fn<RemoteExec>()
    const guarded = new DeployService(exec)
    await expect(guarded.readLog('app', 'x; rm -rf ~', 0)).rejects.toThrow(/id/)
    await expect(guarded.startRollback('a b', 'd1', 'd2')).rejects.toThrow(/name/)
    expect(exec).not.toHaveBeenCalled()
  })
})

describe('newDeployId', () => {
  it('starts with a sortable UTC timestamp', () => {
    expect(newDeployId(new Date('2026-11-06T13:05:09Z'))).toMatch(/^20261106130509-[0-9a-f]{4}$/)
  })
})
