import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile, execFileSync, spawn, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import { createServer, type Server } from 'http'
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync, readlinkSync, readdirSync, rmSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const run = promisify(execFile)
const SCRIPT = resolve(__dirname, '../../../resources/deploy/shellway-deploy.sh')

interface RunResult { code: number; stdout: string; stderr: string }

let base: string
let home: string
let root: string
let origin: string
let work: string
let www: string
let crontabFile: string
let fakeCrontab: string

const gitEnv = {
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@t'
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, env: { ...process.env, ...gitEnv } })
  return stdout.trim()
}

async function commit(files: Record<string, string>, message = 'change'): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(work, path, '..'), { recursive: true })
    writeFileSync(join(work, path), content)
  }
  await git(work, 'add', '-A')
  await git(work, 'commit', '-q', '-m', message)
  await git(work, 'push', '-q', 'origin', 'main')
  return git(work, 'rev-parse', 'HEAD')
}

function runnerEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    SHELLWAY_DEPLOY_ROOT: root,
    SHELLWAY_CRONTAB: fakeCrontab,
    SHELLWAY_HEALTH_DELAY: '0',
    SHELLWAY_CRON_PROCESSES: 'node',
    ...overrides
  }
}

async function runner(...args: string[]): Promise<RunResult> {
  return runnerWith({}, ...args)
}

async function runnerWith(env: NodeJS.ProcessEnv, ...args: string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await run(process.env.RUNNER_SHELL ?? 'sh', [SCRIPT, ...args], { env: runnerEnv(env) })
    return { code: 0, stdout, stderr }
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string }
    return { code: e.code, stdout: e.stdout, stderr: e.stderr }
  }
}

type Conf = Record<string, string>

function writeSite(name: string, conf: Conf, build: string[] = [], activate: string[] = []): void {
  const dir = join(root, 'sites', name)
  mkdirSync(dir, { recursive: true })
  const merged: Conf = { SITE_PATH: join(www, name), REPO_URL: origin, BRANCH: 'main', SOURCE_MODE: 'auto', LAYOUT: 'releases', ...conf }
  writeFileSync(join(dir, 'site.conf'), Object.entries(merged).map(([k, v]) => `${k}='${v.replace(/'/g, "'\\''")}'`).join('\n') + '\n')
  writeFileSync(join(dir, 'steps.build'), build.map((s) => s + '\n').join(''))
  writeFileSync(join(dir, 'steps.activate'), activate.map((s) => s + '\n').join(''))
}

function siteFile(name: string, file: string): string {
  const path = join(root, 'sites', name, file)
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : ''
}

function history(name: string): string[][] {
  const latest = new Map<string, string[]>()
  for (const line of siteFile(name, 'history.tsv').split('\n').filter(Boolean)) {
    const fields = line.split('\t')
    latest.delete(fields[0])
    latest.set(fields[0], fields)
  }
  return [...latest.values()]
}

function lastStatus(name: string): string {
  const all = history(name)
  return all[all.length - 1]?.[1] ?? ''
}

function releases(name: string): string[] {
  const dir = join(www, `${name}-deploy`, 'releases')
  return existsSync(dir) ? readdirSync(dir).sort() : []
}

function served(name: string, file: string): string {
  return readFileSync(join(www, name, file), 'utf8')
}

function startRunner(...args: string[]): { child: ChildProcess; exited: Promise<number | null> } {
  const child = spawn(process.env.RUNNER_SHELL ?? 'sh', [SCRIPT, ...args], { env: runnerEnv() })
  return { child, exited: new Promise((done) => child.on('close', done)) }
}

function fakeCommand(name: string, body: string): void {
  const bin = join(home, '.local', 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`)
  chmodSync(join(bin, name), 0o755)
}

function wrapGit(before: string): void {
  const realGit = execFileSync('sh', ['-c', 'command -v git']).toString().trim()
  fakeCommand('git', `${before}\nexec ${realGit} "$@"`)
}

async function waitUntil(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 25))
  }
}

function processRunning(pattern: string): boolean {
  try {
    execFileSync('pgrep', ['-f', pattern])
    return true
  } catch {
    return false
  }
}

async function deployWithId(name: string, id: string, ...extra: string[]): Promise<RunResult> {
  return runner('deploy', name, '--id', id, ...extra)
}

describe.skipIf(process.platform === 'win32')('shellway-deploy runner', () => {
  beforeEach(async () => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'sw-deploy-')))
    home = join(base, 'home')
    root = join(home, '.shellway-deploy')
    origin = join(base, 'origin.git')
    work = join(base, 'work')
    www = join(base, 'www')
    crontabFile = join(base, 'crontab.txt')
    fakeCrontab = join(base, 'fake-crontab')
    mkdirSync(home, { recursive: true })
    mkdirSync(www, { recursive: true })
    writeFileSync(fakeCrontab, `#!/bin/sh\nif [ "$1" = -l ]; then cat "${crontabFile}" 2>/dev/null || exit 1; else cat > "${crontabFile}"; fi\n`, { mode: 0o755 })
    await run('git', ['init', '-q', '--bare', '-b', 'main', origin])
    await run('git', ['init', '-q', '-b', 'main', work])
    await git(work, 'remote', 'add', 'origin', origin)
    await commit({ 'index.html': 'v1', 'storage/.gitignore': '*\n!.gitignore\n' }, 'first')
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  describe('releases layout', () => {
    it('creates a release, links current and the site path, and records success', async () => {
      writeSite('app', {})
      const result = await deployWithId('app', 'd1')
      expect(result.code).toBe(0)
      expect(lastStatus('app')).toBe('success')
      expect(releases('app')).toEqual(['d1'])
      expect(readlinkSync(join(www, 'app'))).toBe(join(www, 'app-deploy', 'current'))
      expect(readlinkSync(join(www, 'app-deploy', 'current'))).toBe(join(www, 'app-deploy', 'releases', 'd1'))
      expect(served('app', 'index.html')).toBe('v1')
      expect(siteFile('app', 'current')).toBe(await git(work, 'rev-parse', 'HEAD'))
    })

    it('marks failed and keeps the previous release live when a required build step fails', async () => {
      writeSite('app', {})
      await deployWithId('app', 'd1')
      await commit({ 'index.html': 'v2' })
      writeSite('app', {}, ['R\tfalse'])
      await deployWithId('app', 'd2')
      expect(lastStatus('app')).toBe('failed')
      expect(served('app', 'index.html')).toBe('v1')
      expect(releases('app')).toEqual(['d1'])
    })

    it('still records success when an old release cannot be deleted', async () => {
      writeSite('app', { KEEP_RELEASES: '1' })
      await deployWithId('app', 'd1')
      const stuck = join(www, 'app-deploy', 'releases', 'd1', 'stuck')
      mkdirSync(stuck)
      writeFileSync(join(stuck, 'file'), 'x')
      chmodSync(stuck, 0o500)
      try {
        await commit({ 'index.html': 'v2' })
        await deployWithId('app', 'd2')
        expect(lastStatus('app')).toBe('success')
        expect(served('app', 'index.html')).toBe('v2')
      } finally {
        chmodSync(stuck, 0o700)
      }
    })

    it('records a warning and still switches when an optional step fails', async () => {
      writeSite('app', {}, ['O\texit 3'], ['O\tfalse', 'R\ttrue'])
      await deployWithId('app', 'd1')
      const [record] = history('app')
      expect(record[1]).toBe('warning')
      expect(record[6]).toBe('2')
      expect(served('app', 'index.html')).toBe('v1')
    })

    it('replaces git-tracked shared dirs with links and keeps shared content across deploys', async () => {
      writeSite('app', { SHARED_PATHS: '.env storage' })
      mkdirSync(join(www, 'app-deploy', 'shared'), { recursive: true })
      writeFileSync(join(www, 'app-deploy', 'shared', '.env'), 'SECRET=1')
      await deployWithId('app', 'd1')
      writeFileSync(join(www, 'app', 'storage', 'upload.txt'), 'kept')
      await commit({ 'index.html': 'v2', '.env': 'FROM_GIT=1' })
      await deployWithId('app', 'd2')
      expect(lastStatus('app')).toBe('success')
      expect(served('app', '.env')).toBe('SECRET=1')
      expect(served('app', 'storage/upload.txt')).toBe('kept')
      expect(lstatSync(join(www, 'app-deploy', 'releases', 'd2', 'storage')).isSymbolicLink()).toBe(true)
      expect(existsSync(join(www, 'app-deploy', 'shared', 'storage', '.gitignore'))).toBe(true)
    })

    it('runs step commands exactly as typed', async () => {
      writeSite('app', {}, ['R\tprintf \'%s|%s\' "$SHELLWAY_SITE" "it\'s" | tr a-z A-Z > out.txt && echo "$HOME" >> out.txt'])
      await deployWithId('app', 'd1')
      expect(served('app', 'out.txt')).toBe(`APP|IT'S${home}\n`)
    })

    it('moves an existing real directory aside and seeds shared files from it on first deploy', async () => {
      mkdirSync(join(www, 'app'))
      writeFileSync(join(www, 'app', '.env'), 'LIVE=1')
      writeSite('app', { SHARED_PATHS: '.env' })
      await deployWithId('app', 'd1')
      expect(lastStatus('app')).toBe('success')
      expect(existsSync(join(www, 'app.pre-shellway', '.env'))).toBe(true)
      expect(served('app', '.env')).toBe('LIVE=1')
    })

    it('restores the original directory when an activate step fails on first deploy', async () => {
      mkdirSync(join(www, 'app'))
      writeFileSync(join(www, 'app', 'index.html'), 'old live')
      writeSite('app', {}, [], ['R\tfalse'])
      await deployWithId('app', 'd1')
      expect(lastStatus('app')).toBe('reverted')
      expect(lstatSync(join(www, 'app')).isDirectory()).toBe(true)
      expect(served('app', 'index.html')).toBe('old live')
      expect(existsSync(join(www, 'app.pre-shellway'))).toBe(false)
    })

    it('fails without reverting when auto revert is off', async () => {
      writeSite('app', {})
      await deployWithId('app', 'd1')
      await commit({ 'index.html': 'v2' })
      writeSite('app', { HEALTH_REVERT: '0' }, [], ['R\tfalse'])
      await deployWithId('app', 'd2')
      expect(lastStatus('app')).toBe('failed')
      expect(served('app', 'index.html')).toBe('v2')
    })

    describe('health check', () => {
      let server: Server
      let status = 200
      let url = ''

      beforeEach(async () => {
        server = createServer((_req, res) => { res.statusCode = status; res.end('ok') })
        await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
        const address = server.address() as { port: number }
        url = `http://127.0.0.1:${address.port}/`
      })

      afterEach(() => new Promise<void>((done) => server.close(() => done())))

      it('switches back to the previous release when the health check fails', async () => {
        status = 200
        writeSite('app', { HEALTH_URL: url })
        await deployWithId('app', 'd1')
        expect(lastStatus('app')).toBe('success')
        status = 500
        await commit({ 'index.html': 'v2' })
        await deployWithId('app', 'd2')
        expect(lastStatus('app')).toBe('reverted')
        expect(served('app', 'index.html')).toBe('v1')
        expect(siteFile('app', 'current')).not.toBe(await git(work, 'rev-parse', 'HEAD'))
      })
    })

    it('rolls back to a kept release and runs only activate steps', async () => {
      writeSite('app', {}, ['R\techo build >> "$HOME/build.log"'], ['R\techo activate >> "$HOME/activate.log"'])
      const first = await git(work, 'rev-parse', 'HEAD')
      await deployWithId('app', 'd1')
      await commit({ 'index.html': 'v2' })
      await deployWithId('app', 'd2')
      const result = await runner('rollback', 'app', 'd1', '--id', 'r1')
      expect(result.code).toBe(0)
      expect(served('app', 'index.html')).toBe('v1')
      expect(siteFile('app', 'current')).toBe(first)
      expect(readFileSync(join(home, 'build.log'), 'utf8').trim().split('\n')).toHaveLength(2)
      expect(readFileSync(join(home, 'activate.log'), 'utf8').trim().split('\n')).toHaveLength(3)
      expect(history('app').at(-1)?.[2]).toBe('rollback')
    })

    it('keeps only the newest releases plus the current one', async () => {
      writeSite('app', { KEEP_RELEASES: '2' })
      for (const id of ['d1', 'd2', 'd3', 'd4']) {
        await commit({ 'index.html': id })
        await deployWithId('app', id)
      }
      expect(releases('app')).toEqual(['d3', 'd4'])
    })
  })

  describe('in-place layout', () => {
    it('updates the working tree and keeps untracked files', async () => {
      writeSite('app', { LAYOUT: 'inplace', SHARED_PATHS: '.env' })
      mkdirSync(join(www, 'app'))
      writeFileSync(join(www, 'app', '.env'), 'LIVE=1')
      await deployWithId('app', 'd1')
      await commit({ 'index.html': 'v2' })
      await deployWithId('app', 'd2')
      expect(lastStatus('app')).toBe('success')
      expect(served('app', 'index.html')).toBe('v2')
      expect(served('app', '.env')).toBe('LIVE=1')
    })

    it('refuses to deploy when a shared path is tracked in git', async () => {
      await commit({ '.env': 'COMMITTED=1' })
      writeSite('app', { LAYOUT: 'inplace', SHARED_PATHS: '.env' })
      await deployWithId('app', 'd1')
      expect(lastStatus('app')).toBe('failed')
      expect(history('app')[0][7]).toContain('.env is tracked')
      expect(existsSync(join(www, 'app', 'index.html'))).toBe(false)
    })

    it('rolls back by resetting to the earlier commit', async () => {
      writeSite('app', { LAYOUT: 'inplace' })
      await deployWithId('app', 'd1')
      await commit({ 'index.html': 'v2' })
      await deployWithId('app', 'd2')
      await runner('rollback', 'app', 'd1', '--id', 'r1')
      expect(served('app', 'index.html')).toBe('v1')
    })
  })

  describe('locking', () => {
    it('exits busy while another deploy holds the lock', async () => {
      writeSite('app', {})
      mkdirSync(join(root, 'sites', 'app', 'lock'))
      writeFileSync(join(root, 'sites', 'app', 'lock', 'pid'), String(process.pid))
      const result = await deployWithId('app', 'd1')
      expect(result.code).toBe(75)
      expect(releases('app')).toEqual([])
    })

    it('reclaims a stale lock whose owner is gone', async () => {
      writeSite('app', {})
      mkdirSync(join(root, 'sites', 'app', 'lock'))
      writeFileSync(join(root, 'sites', 'app', 'lock', 'pid'), '999999')
      const result = await deployWithId('app', 'd1')
      expect(result.code).toBe(0)
      expect(lastStatus('app')).toBe('success')
      expect(existsSync(join(root, 'sites', 'app', 'lock'))).toBe(false)
    })

    it('closes a deploy that a killed runner left running', async () => {
      writeSite('app', {})
      writeFileSync(join(root, 'sites', 'app', 'history.tsv'), 'old\trunning\tmanual\t-\t100\t\t0\t\n')
      await deployWithId('app', 'd1')
      const byId = Object.fromEntries(history('app').map((r) => [r[0], r]))
      expect(byId.old[1]).toBe('failed')
      expect(byId.old[7]).toBe('interrupted')
      expect(byId.d1[1]).toBe('success')
    })

    it('records an interrupted deploy as failed when the runner is stopped', async () => {
      writeSite('app', {}, ['R\tsleep 36'])
      const { child, exited } = startRunner('deploy', 'app', '--id', 'd1')
      await waitUntil(() => siteFile('app', 'progress').includes('COMMAND=sleep 36'))
      child.kill('SIGTERM')
      await exited
      const [record] = history('app')
      expect(record[1]).toBe('failed')
      expect(record[7]).toBe('interrupted')
      expect(existsSync(join(root, 'sites', 'app', 'lock'))).toBe(false)
      await waitUntil(() => !processRunning('sleep 36'))
    })
  })

  describe('applying an env change', () => {
    it('reruns the after-going-live commands on the live release without a new release', async () => {
      writeSite('app', {}, [], ['R\techo applied >> applied.txt'])
      await deployWithId('app', 'd1')
      const result = await runner('apply', 'app', '--id', 'a1')
      expect(result.code).toBe(0)
      const [, record] = history('app')
      expect(record[0]).toBe('a1')
      expect(record[1]).toBe('success')
      expect(record[2]).toBe('env')
      expect(record[3]).toBe(siteFile('app', 'current'))
      expect(releases('app')).toEqual(['d1'])
      expect(served('app', 'applied.txt')).toBe('applied\napplied\n')
    })

    it('marks the apply failed when a required command fails', async () => {
      writeSite('app', {})
      await deployWithId('app', 'd1')
      writeSite('app', {}, [], ['R\tfalse'])
      await runner('apply', 'app', '--id', 'a1')
      expect(lastStatus('app')).toBe('failed')
      expect(served('app', 'index.html')).toBe('v1')
    })

    it('refuses when nothing is deployed yet', async () => {
      writeSite('app', {})
      const result = await runner('apply', 'app', '--id', 'a1')
      expect(result.code).not.toBe(0)
      expect(history('app')).toHaveLength(0)
    })
  })

  describe('status and output', () => {
    it('counts the commits the live site is behind once the server has them', async () => {
      writeSite('app', {}, ['R\ttest ! -f broken'])
      await runner('tick', 'app')
      expect((await runner('status', 'app')).stdout).toContain('BEHIND=0\n')
      await commit({ broken: 'x' })
      await commit({ 'index.html': 'v3' })
      writeFileSync(join(root, 'sites', 'app', 'heartbeat'), '0')
      await runner('tick', 'app')
      expect(lastStatus('app')).toBe('failed')
      expect((await runner('status', 'app')).stdout).toContain('BEHIND=2\n')
    })

    it('prints state as key=value lines', async () => {
      writeSite('app', {})
      await deployWithId('app', 'd1')
      const { stdout } = await runner('status', 'app')
      const head = await git(work, 'rev-parse', 'HEAD')
      expect(stdout).toContain(`CURRENT=${head}\n`)
      expect(stdout).toContain('CURRENT_RELEASE=d1\n')
      expect(stdout).toContain(`MIRROR_HEAD=${head}\n`)
      expect(stdout).toContain('BUSY=0\n')
    })

    it('returns the deploy log from an offset', async () => {
      writeSite('app', {})
      await deployWithId('app', 'd1')
      const full = (await runner('log', 'app', 'd1')).stdout
      const tail = (await runner('log', 'app', 'd1', '5')).stdout
      expect(full).toContain('deploy success')
      expect(tail).toBe(full.slice(5))
    })

    it('dumps every site with config, steps, status and history', async () => {
      writeSite('app', {}, ['R\tcomposer install'])
      writeSite('api', { SOURCE_MODE: 'pc' })
      await deployWithId('app', 'd1')
      const { stdout } = await runner('dump')
      expect(stdout).toMatch(/@@SITE api\n@@CONF\n[\s\S]*@@END\n@@SITE app\n/)
      expect(stdout).toContain('@@BUILD\nR\tcomposer install\n@@ACTIVATE\n')
      expect(stdout).toMatch(/@@HISTORY\nd1\trunning/)
    })

    it('rejects site names that could escape the sites folder', async () => {
      const result = await runner('status', '../etc')
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('invalid name')
    })
  })

  describe('auto ticks', () => {
    it('deploys a new head once and does not retry a failed head', async () => {
      writeSite('app', {}, ['R\ttest ! -f broken'])
      await runner('tick', 'app')
      expect(lastStatus('app')).toBe('success')
      expect(siteFile('app', 'remote_head')).toBe(await git(work, 'rev-parse', 'HEAD'))

      await commit({ broken: 'x' })
      writeFileSync(join(root, 'sites', 'app', 'heartbeat'), '0')
      await runner('tick', 'app')
      expect(lastStatus('app')).toBe('failed')

      writeFileSync(join(root, 'sites', 'app', 'heartbeat'), '0')
      await runner('tick', 'app')
      expect(history('app')).toHaveLength(2)
    })

    it('does not start a new deploy every tick when fetching the code fails', async () => {
      writeSite('app', {})
      writeFileSync(join(root, 'sites', 'app', 'repo.git'), 'not a repository')
      await runner('tick', 'app')
      writeFileSync(join(root, 'sites', 'app', 'heartbeat'), '0')
      await runner('tick', 'app')
      expect(history('app')).toHaveLength(1)
      expect(lastStatus('app')).toBe('failed')
    })

    it('checks less often after the repository could not be reached', async () => {
      writeSite('app', { REPO_URL: join(base, 'missing.git'), POLL_MINUTES: '1' })
      await runner('tick', 'app')
      expect(siteFile('app', 'check_failures')).toBe('1')
      const now = Math.floor(Date.now() / 1000)
      writeFileSync(join(root, 'sites', 'app', 'heartbeat'), String(now - 90))
      await runner('tick', 'app')
      expect(siteFile('app', 'check_failures')).toBe('1')
      writeFileSync(join(root, 'sites', 'app', 'heartbeat'), String(now - 200))
      await runner('tick', 'app')
      expect(siteFile('app', 'check_failures')).toBe('2')
    })

    it('skips when the last check is younger than the poll interval', async () => {
      writeSite('app', { POLL_MINUTES: '5' })
      writeFileSync(join(root, 'sites', 'app', 'heartbeat'), String(Math.floor(Date.now() / 1000)))
      await runner('tick', 'app')
      expect(history('app')).toHaveLength(0)
    })

    it('tick-all only ticks auto sites', async () => {
      writeSite('auto-site', {})
      writeSite('pc-site', { SOURCE_MODE: 'pc' })
      await runner('tick-all')
      expect(lastStatus('auto-site')).toBe('success')
      expect(history('pc-site')).toHaveLength(0)
      expect(siteFile('pc-site', 'heartbeat')).toBe('')
    })
  })

  describe('cron', () => {
    it('installs one marker line idempotently and removes only that line', async () => {
      writeFileSync(crontabFile, '0 3 * * * backup.sh\n')
      await runner('cron-install')
      await runner('cron-install')
      const installed = readFileSync(crontabFile, 'utf8')
      expect(installed.match(/# shellway-deploy/g)).toHaveLength(1)
      expect(installed).toContain('0 3 * * * backup.sh')
      expect(installed).toContain(`"${root}/bin/shellway-deploy" tick-all`)
      await runner('cron-remove')
      expect(readFileSync(crontabFile, 'utf8')).toBe('0 3 * * * backup.sh\n')
    })

    it('sync-cron installs only while an auto site exists', async () => {
      writeSite('pc-site', { SOURCE_MODE: 'pc' })
      await runner('sync-cron')
      expect(existsSync(crontabFile) ? readFileSync(crontabFile, 'utf8') : '').not.toContain('shellway-deploy')
      writeSite('auto-site', {})
      await runner('sync-cron')
      expect(readFileSync(crontabFile, 'utf8')).toContain('shellway-deploy')
    })
  })

  describe('from-pc bundles', () => {
    it('deploys commits fetched from an uploaded bundle', async () => {
      writeSite('app', { SOURCE_MODE: 'pc', REPO_URL: 'git@example.invalid:x/y.git' })
      const bundle = join(base, 'up.bundle')
      await git(work, 'bundle', 'create', bundle, 'refs/heads/main')
      const result = await deployWithId('app', 'd1', '--bundle', bundle)
      expect(result.code).toBe(0)
      expect(lastStatus('app')).toBe('success')
      expect(existsSync(bundle)).toBe(false)
    })

    it('fails clearly when a pc site is deployed without a bundle and no known commit', async () => {
      writeSite('app', { SOURCE_MODE: 'pc', REPO_URL: 'git@example.invalid:x/y.git' })
      await deployWithId('app', 'd1')
      expect(lastStatus('app')).toBe('failed')
    })
  })

  describe('migration approval', () => {
    it('waits when new migrations arrive and deploys after approval', async () => {
      writeSite('app', { APPROVE_MIGRATIONS: '1' })
      await deployWithId('app', 'd1')
      const migration = await commit({ 'database/migrations/2026_add.php': '<?php' })
      await deployWithId('app', 'd2')
      expect(lastStatus('app')).toBe('waiting')
      expect(served('app', 'index.html')).toBe('v1')
      expect(existsSync(join(www, 'app', 'database'))).toBe(false)
      expect(siteFile('app', 'pending')).toBe(migration)

      await runner('approve', 'app', '--id', 'a1')
      expect(lastStatus('app')).toBe('success')
      expect(existsSync(join(www, 'app', 'database', 'migrations', '2026_add.php'))).toBe(true)
      expect(siteFile('app', 'pending')).toBe('')
    })

    it('does not wait when no migration files changed', async () => {
      writeSite('app', { APPROVE_MIGRATIONS: '1' })
      await deployWithId('app', 'd1')
      await commit({ 'index.html': 'v2' })
      await deployWithId('app', 'd2')
      expect(lastStatus('app')).toBe('success')
    })
  })

  describe('doctor and env path', () => {
    it('reports the site path kind and sudo needs', async () => {
      writeSite('app', {}, [], ['R\tsudo systemctl restart my-worker', 'R\tphp artisan up'])
      const { stdout } = await runner('doctor', 'app')
      expect(stdout).toContain('SITE_PATH_KIND=missing\n')
      expect(stdout).toContain('PARENT_WRITABLE=1\n')
      expect(stdout).toMatch(/SUDO_(OK|NEEDS)\t\S*systemctl restart my-worker\n/)
      expect(stdout).not.toContain('artisan')
    })

    it('points at the shared env file for releases and the site file for in-place', async () => {
      writeSite('rel', {})
      writeSite('inp', { LAYOUT: 'inplace' })
      expect((await runner('env-path', 'rel')).stdout.trim()).toBe(join(www, 'rel-deploy', 'shared', '.env'))
      expect((await runner('env-path', 'inp')).stdout.trim()).toBe(join(www, 'inp', '.env'))
    })
  })

  describe('progress and commit message', () => {
    it('prints the message of the live commit', async () => {
      writeSite('app', {})
      await deployWithId('app', 'd1')
      expect((await runner('status', 'app')).stdout).toContain('CURRENT_SUBJECT=first\n')
    })

    it('reports the running stage, step and command without the process id', async () => {
      writeSite('app', {}, ['R\techo one', 'R\tsleep 2'], ['R\techo live'])
      const { exited } = startRunner('deploy', 'app', '--id', 'd1')
      await waitUntil(() => siteFile('app', 'progress').includes('COMMAND=sleep 2'))
      const { stdout } = await runner('status', 'app')
      expect(stdout).toContain('BUSY=1\n')
      expect(stdout).toContain('STAGE=build\nSTEP=2\nSTEPS=3\nCOMMAND=sleep 2\n')
      expect(stdout).not.toContain('STEP_PID')
      await exited
      expect((await runner('status', 'app')).stdout).not.toContain('STAGE=')
      expect(existsSync(join(root, 'sites', 'app', 'progress'))).toBe(false)
    })
  })

  describe('cancelling', () => {
    it('stops the running build command and leaves the live site untouched', async () => {
      writeSite('app', {})
      await deployWithId('app', 'd1')
      await commit({ 'index.html': 'v2' })
      writeSite('app', {}, ['R\tsleep 37 && echo late > late.txt'])
      const { exited } = startRunner('deploy', 'app', '--id', 'd2')
      await waitUntil(() => siteFile('app', 'progress').includes('COMMAND=sleep 37'))
      const started = Date.now()
      const result = await runner('cancel', 'app')
      expect(result.code).toBe(0)
      await exited
      expect(Date.now() - started).toBeLessThan(10_000)
      const record = history('app').find((r) => r[0] === 'd2')!
      expect(record[1]).toBe('cancelled')
      expect(record[7]).toBe('cancelled; live site untouched')
      expect(served('app', 'index.html')).toBe('v1')
      expect(releases('app')).toEqual(['d1'])
      expect(existsSync(join(root, 'sites', 'app', 'cancel'))).toBe(false)
      expect(existsSync(join(root, 'sites', 'app', 'lock'))).toBe(false)
      await waitUntil(() => !processRunning('sleep 37'))
    })

    it('records a deploy cancelled while fetching the code as cancelled, not failed', async () => {
      writeSite('app', {})
      wrapGit('for arg in "$@"; do [ "$arg" = fetch ] && sleep 39; done')
      const { exited } = startRunner('deploy', 'app', '--id', 'd1')
      await waitUntil(() => processRunning('sleep 39'))
      expect((await runner('cancel', 'app')).code).toBe(0)
      await exited
      const record = history('app').find((r) => r[0] === 'd1')!
      expect(record[1]).toBe('cancelled')
      expect(record[7]).toBe('cancelled; live site untouched')
      await waitUntil(() => !processRunning('sleep 39'))
    })

    it('does not move on to the next command after cancelling an optional one', async () => {
      writeSite('app', {}, ['O\tsleep 38', 'R\techo next'])
      const { exited } = startRunner('deploy', 'app', '--id', 'd1')
      await waitUntil(() => siteFile('app', 'progress').includes('COMMAND=sleep 38'))
      await runner('cancel', 'app')
      await exited
      expect(lastStatus('app')).toBe('cancelled')
      expect(siteFile('app', 'logs/d1.log')).not.toContain('$ echo next')
    })

    it('refuses to stop an in-place deploy once the site folder has the new code', async () => {
      writeSite('app', { LAYOUT: 'inplace' })
      await deployWithId('app', 'd1')
      await commit({ 'index.html': 'v2' })
      writeSite('app', { LAYOUT: 'inplace' }, ['R\tsleep 1'])
      const { exited } = startRunner('deploy', 'app', '--id', 'd2')
      await waitUntil(() => siteFile('app', 'progress').includes('COMMAND=sleep 1'))
      const result = await runner('cancel', 'app')
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('half-built')
      await exited
      expect(history('app').find((r) => r[0] === 'd2')![1]).toBe('success')
      expect(served('app', 'index.html')).toBe('v2')
    })

    it('ignores a cancel request that arrives after an in-place deploy changed the code', async () => {
      writeSite('app', { LAYOUT: 'inplace' }, [`R\ttouch ${join(root, 'sites', 'app', 'cancel')}`, 'R\techo built'])
      await deployWithId('app', 'd1')
      expect(lastStatus('app')).toBe('success')
      expect(siteFile('app', 'logs/d1.log')).toContain('$ echo built')
    })

    it('refuses once the deploy is going live', async () => {
      writeSite('app', {}, [], ['R\tsleep 1'])
      const { exited } = startRunner('deploy', 'app', '--id', 'd1')
      await waitUntil(() => siteFile('app', 'progress').includes('STAGE=activate'))
      const result = await runner('cancel', 'app')
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('going live')
      expect(existsSync(join(root, 'sites', 'app', 'cancel'))).toBe(false)
      await exited
      expect(lastStatus('app')).toBe('success')
    })

    it('refuses when no deploy is running', async () => {
      writeSite('app', {})
      const result = await runner('cancel', 'app')
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('no deploy is running')
    })

    it('ignores a cancel request left over from an earlier deploy', async () => {
      writeSite('app', {})
      writeFileSync(join(root, 'sites', 'app', 'cancel'), '')
      await deployWithId('app', 'd1')
      expect(lastStatus('app')).toBe('success')
    })
  })

  describe('resuming the auto check', () => {
    it('restores the schedule, clears the back-off and lets the next tick check right away', async () => {
      writeSite('app', {})
      writeFileSync(join(root, 'sites', 'app', 'check_failures'), '4')
      writeFileSync(join(root, 'sites', 'app', 'heartbeat'), '100')
      const result = await runner('resume', 'app')
      expect(result.code).toBe(0)
      expect(readFileSync(crontabFile, 'utf8')).toContain('# shellway-deploy')
      expect(siteFile('app', 'check_failures')).toBe('')
      expect(siteFile('app', 'remote_head')).toBe(await git(work, 'rev-parse', 'HEAD'))
      const age = Math.floor(Date.now() / 1000) - Number(siteFile('app', 'heartbeat'))
      expect(age).toBeGreaterThanOrEqual(59)
      expect(age).toBeLessThan(70)
      await runner('tick', 'app')
      expect(lastStatus('app')).toBe('success')
    })

    it('accepts a cron service that only systemd reports as running', async () => {
      writeSite('app', {})
      fakeCommand('systemctl', '[ "$1 $2 $3" = "is-active --quiet systemd-cron" ]')
      expect((await runnerWith({ SHELLWAY_CRON_PROCESSES: 'systemd-cron' }, 'resume', 'app')).code).toBe(0)
    })

    it('stores the branch head even when git prints warnings', async () => {
      writeSite('app', {})
      wrapGit('echo "warning: redirecting to elsewhere" >&2')
      const head = await git(work, 'rev-parse', 'HEAD')
      expect((await runner('resume', 'app')).stdout.trim()).toBe(head)
      expect(siteFile('app', 'remote_head')).toBe(head)
      expect((await runner('check-remote', 'app')).stdout.trim()).toBe(head)
    })

    it('explains when the cron service is not running', async () => {
      writeSite('app', {})
      writeFileSync(join(root, 'sites', 'app', 'check_failures'), '3')
      const result = await runnerWith({ SHELLWAY_CRON_PROCESSES: 'no-such-cron-daemon' }, 'resume', 'app')
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('cron service is not running')
      expect(siteFile('app', 'check_failures')).toBe('3')
    })

    it('reports why the repository cannot be reached and keeps the back-off', async () => {
      writeSite('app', { REPO_URL: join(base, 'missing.git') })
      writeFileSync(join(root, 'sites', 'app', 'check_failures'), '3')
      const result = await runner('resume', 'app')
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('missing.git')
      expect(siteFile('app', 'check_failures')).toBe('3')
    })

    it('refuses sites deployed from the PC', async () => {
      writeSite('app', { SOURCE_MODE: 'pc' })
      const result = await runner('resume', 'app')
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('auto')
    })
  })

  describe('previewing what would ship', () => {
    const rows = (out: string, key: string) => out.split('\n').filter((l) => l.startsWith(`${key}\t`)).map((l) => l.split('\t').slice(1))
    const value = (out: string, key: string) => out.split('\n').find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1)
    const stateFiles = (name: string) => readdirSync(join(root, 'sites', name)).filter((f) => f !== 'repo.git').sort()

    it('shows only the head commit and its files when nothing is live yet', async () => {
      writeSite('app', {})
      const head = await git(work, 'rev-parse', 'HEAD')
      const result = await runner('preview', 'app')
      expect(result.code).toBe(0)
      expect(value(result.stdout, 'FROM')).toBe('')
      expect(value(result.stdout, 'TO')).toBe(head)
      expect(value(result.stdout, 'BRANCH')).toBe('main')
      expect(value(result.stdout, 'TOTAL_COMMITS')).toBe('1')
      expect(rows(result.stdout, 'COMMIT')).toEqual([[head, expect.stringMatching(/^\d+$/), 'Test', '0', 'first']])
      expect(rows(result.stdout, 'FILE')).toEqual([['A', '1', '0', '0', 'index.html'], ['A', '2', '0', '0', 'storage/.gitignore']])
      expect(value(result.stdout, 'TOTAL_FILES')).toBe('2')
    })

    it('lists the commits and files between the live commit and the branch head', async () => {
      writeSite('app', {})
      await deployWithId('app', 'd1')
      const live = await git(work, 'rev-parse', 'HEAD')
      const migration = await commit({ 'index.html': 'v2\n', 'database/migrations/2026_add.php': '<?php\n' }, 'Add tax region')
      rmSync(join(work, 'storage', '.gitignore'))
      const head = await commit({ 'extra.txt': 'x\n' }, 'Add\textra')
      const result = await runner('preview', 'app')
      expect(value(result.stdout, 'FROM')).toBe(live)
      expect(value(result.stdout, 'TO')).toBe(head)
      expect(value(result.stdout, 'TOTAL_COMMITS')).toBe('2')
      expect(rows(result.stdout, 'COMMIT').map((c) => [c[0], c[3], c[4]])).toEqual([[head, '0', 'Add extra'], [migration, '1', 'Add tax region']])
      expect(rows(result.stdout, 'FILE')).toEqual([
        ['A', '1', '0', '1', 'database/migrations/2026_add.php'],
        ['A', '1', '0', '0', 'extra.txt'],
        ['M', '1', '1', '0', 'index.html'],
        ['D', '0', '2', '0', 'storage/.gitignore']
      ])
      expect(value(result.stdout, 'TOTAL_FILES')).toBe('4')
    })

    it('reports nothing to ship when the live commit is the branch head', async () => {
      writeSite('app', {})
      await deployWithId('app', 'd1')
      const result = await runner('preview', 'app')
      expect(result.code).toBe(0)
      expect(value(result.stdout, 'FROM')).toBe(value(result.stdout, 'TO'))
      expect(value(result.stdout, 'TOTAL_COMMITS')).toBe('0')
      expect(rows(result.stdout, 'COMMIT')).toEqual([])
      expect(rows(result.stdout, 'FILE')).toEqual([])
    })

    it('previews the commit waiting for approval rather than the newest one', async () => {
      writeSite('app', { APPROVE_MIGRATIONS: '1' })
      await deployWithId('app', 'd1')
      const pending = await commit({ 'database/migrations/2026_add.php': '<?php\n' }, 'Add table')
      await deployWithId('app', 'd2')
      await commit({ 'later.txt': 'x' }, 'Later change')
      const result = await runner('preview', 'app')
      expect(value(result.stdout, 'TO')).toBe(pending)
      expect(value(result.stdout, 'TOTAL_COMMITS')).toBe('1')
      expect(rows(result.stdout, 'FILE').map((f) => f[4])).toEqual(['database/migrations/2026_add.php'])
    })

    it('marks migrations under a custom folder', async () => {
      writeSite('app', { MIGRATIONS_PATH: 'db/migrate/' })
      await deployWithId('app', 'd1')
      await commit({ 'db/migrate/001_add.rb': 'x', 'database/migrations/ignored.php': 'x' }, 'Add column')
      const result = await runner('preview', 'app')
      expect(rows(result.stdout, 'COMMIT')[0][3]).toBe('1')
      expect(rows(result.stdout, 'FILE').map((f) => [f[4], f[3]])).toEqual([['db/migrate/001_add.rb', '1'], ['database/migrations/ignored.php', '0']])
    })

    it('caps the lists, keeps migrations first and still reports the totals', async () => {
      writeSite('app', {})
      await deployWithId('app', 'd1')
      for (let i = 0; i < 54; i++) await git(work, 'commit', '--allow-empty', '-q', '-m', `empty ${i}`)
      const files = Object.fromEntries(Array.from({ length: 204 }, (_, i) => [`src/file-${String(i).padStart(3, '0')}.txt`, 'x']))
      await commit({ ...files, 'database/migrations/zzz_last.php': '<?php\n' }, 'Many files')
      const result = await runner('preview', 'app')
      expect(value(result.stdout, 'TOTAL_COMMITS')).toBe('55')
      expect(rows(result.stdout, 'COMMIT')).toHaveLength(50)
      expect(value(result.stdout, 'TOTAL_FILES')).toBe('205')
      const listed = rows(result.stdout, 'FILE')
      expect(listed).toHaveLength(200)
      expect(listed[0][4]).toBe('database/migrations/zzz_last.php')
    })

    it('changes nothing but the mirror and works while a deploy holds the lock', async () => {
      writeSite('app', {})
      await deployWithId('app', 'd1')
      await commit({ 'index.html': 'v2' })
      const lock = join(root, 'sites', 'app', 'lock')
      mkdirSync(lock)
      writeFileSync(join(lock, 'pid'), String(process.pid))
      const before = stateFiles('app')
      const historyBefore = siteFile('app', 'history.tsv')
      const currentBefore = siteFile('app', 'current')
      const result = await runner('preview', 'app')
      expect(result.code).toBe(0)
      expect(stateFiles('app')).toEqual(before)
      expect(siteFile('app', 'history.tsv')).toBe(historyBefore)
      expect(siteFile('app', 'lock/pid')).toBe(String(process.pid))
      expect(siteFile('app', 'current')).toBe(currentBefore)
    })

    it('explains when the repository cannot be reached', async () => {
      writeSite('app', { REPO_URL: join(base, 'missing.git') })
      const result = await runner('preview', 'app')
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('could not fetch main')
    })

    it('refuses sites deployed from the PC', async () => {
      writeSite('app', { SOURCE_MODE: 'pc' })
      const result = await runner('preview', 'app')
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('PC')
    })
  })
})
