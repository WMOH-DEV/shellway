import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'fs'
import type { DeployOptions } from '../../../src/types/deploy'
import { tmpdir } from 'os'
import { join } from 'path'
import { DeployService, newDeployId } from './DeployService'
import { LocalGit } from './LocalGit'
import { deployFromPc } from './pcDeploy'
import { fakeCrontab, git, localExec, makeSite, waitForDeploy } from './testFixtures'

let base: string
let origin: string
let work: string
let service: DeployService
let local: LocalGit

function commit(content: string): string {
  writeFileSync(join(work, 'index.html'), content)
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', content)
  git(work, 'push', '-q', 'origin', 'main')
  return git(work, 'rev-parse', 'HEAD')
}

const served = () => readFileSync(join(base, 'www', 'app', 'index.html'), 'utf8')

async function deployNow(mirrorHead: string, options: DeployOptions = {}): Promise<string> {
  const id = newDeployId()
  await deployFromPc(service, local, site(), { mirrorHead }, id, 'manual', options)
  return waitForDeploy(service, 'app', id)
}

const site = () => makeSite({
  name: 'app',
  path: join(base, 'www', 'app'),
  repoUrl: origin,
  sourceMode: 'pc',
  sharedPaths: [],
  healthUrl: '',
  buildSteps: [],
  activateSteps: []
})

describe.skipIf(process.platform === 'win32')('deployFromPc', () => {
  beforeEach(async () => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'sw-pc-')))
    origin = join(base, 'origin.git')
    work = join(base, 'work')
    const home = join(base, 'home')
    mkdirSync(home)
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
    execFileSync('git', ['init', '-q', '-b', 'main', work])
    git(work, 'remote', 'add', 'origin', origin)
    service = new DeployService(localExec({ ...process.env, HOME: home, SHELLWAY_CRONTAB: fakeCrontab(base).bin }))
    local = new LocalGit(join(base, 'pc-cache'), { allowLocalRepos: true })
    await service.installRunner()
    await service.saveSite(site())
  })

  afterEach(() => rmSync(base, { recursive: true, force: true }))

  it('sends a full bundle first, then only new commits', async () => {
    const first = commit('v1')
    expect(await deployNow('')).toBe('success')
    expect(served()).toBe('v1')
    commit('v2')
    expect(await deployNow(first)).toBe('success')
    expect(served()).toBe('v2')
  })

  it('redeploys without uploading when the server already has the head', async () => {
    const first = commit('v1')
    await deployNow('')
    expect(await deployNow(first)).toBe('success')
    expect(served()).toBe('v1')
  })

  it('falls back to a full bundle when the server is missing the base commit', async () => {
    const first = commit('v1')
    commit('v2')
    await local.fetch(origin, 'main')
    expect(await deployNow(first)).toBe('success')
    expect(served()).toBe('v2')
  })

  it('deploys the previewed commit even when the branch moved on since', async () => {
    const first = commit('v1')
    await deployNow('')
    const previewed = commit('v2')
    commit('v3')
    expect(await deployNow(first, { commit: previewed })).toBe('success')
    expect(served()).toBe('v2')
    expect(await deployNow(previewed, { commit: previewed })).toBe('success')
    expect(served()).toBe('v2')
  })

  it('deploys a branch that was moved back to an older commit', async () => {
    const first = commit('v1')
    await deployNow('')
    const second = commit('v2')
    expect(await deployNow(first)).toBe('success')
    git(work, 'reset', '-q', '--hard', first)
    git(work, 'push', '-q', '-f', 'origin', 'main')
    expect(await deployNow(second)).toBe('success')
    expect(served()).toBe('v1')
  })
})
