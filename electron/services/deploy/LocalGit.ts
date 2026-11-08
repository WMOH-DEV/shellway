import { execFile } from 'child_process'
import { createHash, randomBytes } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import type { RepoFiles } from '../../../src/types/createSite'
import type { ShipCommit, ShipFile, ShipFileStatus, ShipPreview } from '../../../src/types/deploy'
import { isMigrationPath, makeShipPreview, orderFiles, PREVIEW_COMMIT_CAP, PREVIEW_FILE_CAP } from './previewShape'
import { isValidBranch } from './siteFiles'

const run = promisify(execFile)
const NETWORK_TIMEOUT_MS = 120_000
const LOCAL_TIMEOUT_MS = 60_000
const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes' })
const REMOTE_PROTOCOLS = ['https', 'ssh', 'git'].flatMap((name) => ['-c', `protocol.${name}.allow=always`])
const REMOTE_URL = /^(https:\/\/|ssh:\/\/|git:\/\/|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:)[^\s]+$/
const COMMIT_SHA = /^[0-9a-f]{40,64}$/
const NO_IDENTITY = /tell me who you are|empty ident|unable to auto-detect email/i
const ROOT_FILE_CAP = 500
const READ_FILE_CAP = 64 * 1024
const READ_FILES = ['package.json', 'composer.json', '.env.example'] as const

export interface BundleResult {
  file: string
  full: boolean
}

export interface PreviewRequest {
  url: string
  branch: string
  live: string
  pending: string
  migrationsPath: string
}

const DIFF_STATUSES: ReadonlySet<string> = new Set(['A', 'M', 'D', 'R'])

export function parseCommitLog(stdout: string, migrationShas: ReadonlySet<string>): ShipCommit[] {
  return stdout.split('\n').filter(Boolean).map((line) => {
    const [sha, time, author, ...subject] = line.split('\t')
    return { sha, time: Number.parseInt(time, 10) || 0, author, subject: subject.join(' '), migration: migrationShas.has(sha) }
  })
}

function diffCommand(base: string, to: string): string[] {
  const flags = ['--no-renames', '--raw', '--numstat']
  return base ? ['diff', ...flags, base, to] : ['show', '--format=', ...flags, to]
}

function countOrNull(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseDiff(stdout: string, migrationsPath: string): ShipFile[] {
  const statuses = new Map<string, string>()
  const counts = new Map<string, [string, string]>()
  for (const line of stdout.split('\n')) {
    const [head, ...rest] = line.split('\t')
    if (line.startsWith(':')) statuses.set(rest.join('\t'), head.slice(-1))
    else if (rest.length >= 2) counts.set(rest.slice(1).join('\t'), [head, rest[0]])
  }
  return [...statuses].map(([path, status]) => {
    const [added, removed] = counts.get(path) ?? ['-', '-']
    return {
      status: (DIFF_STATUSES.has(status) ? status : 'M') as ShipFileStatus,
      path,
      added: countOrNull(added),
      removed: countOrNull(removed),
      migration: isMigrationPath(path, migrationsPath)
    }
  })
}

function gitError(err: unknown, fallback: string): Error {
  const stderr = (err as { stderr?: string }).stderr?.trim()
  return new Error(stderr || (err as Error).message || fallback)
}

export interface LocalGitOptions {
  allowLocalRepos?: boolean
}

export class LocalGit {
  private readonly protocols: string[]

  constructor(private readonly cacheDir: string, private readonly options: LocalGitOptions = {}) {
    const local = options.allowLocalRepos ? ['-c', 'protocol.file.allow=always'] : []
    this.protocols = ['-c', 'protocol.allow=never', ...REMOTE_PROTOCOLS, ...local]
  }

  async available(): Promise<boolean> {
    try {
      await run('git', ['--version'], { timeout: LOCAL_TIMEOUT_MS })
      return true
    } catch {
      return false
    }
  }

  async lsRemote(url: string, branch: string): Promise<string> {
    this.assertRemote(url, branch)
    const { stdout } = await this.git([...this.protocols, 'ls-remote', '--', url, `refs/heads/${branch}`], NETWORK_TIMEOUT_MS, 'Could not reach the repository')
    const head = stdout.split('\t')[0].trim()
    if (!head) throw new Error(`Branch ${branch} was not found`)
    return head
  }

  async fetch(url: string, branch: string): Promise<string> {
    this.assertRemote(url, branch)
    const mirror = this.mirrorPath(url)
    if (!existsSync(mirror)) {
      mkdirSync(this.cacheDir, { recursive: true })
      await this.git(['init', '--bare', '-q', mirror], LOCAL_TIMEOUT_MS, 'Could not create the local cache')
    }
    await this.git([...this.protocols, '--git-dir', mirror, 'fetch', '-q', '--', url, `+refs/heads/${branch}:refs/heads/${branch}`], NETWORK_TIMEOUT_MS, 'Could not fetch the repository')
    const { stdout } = await this.git(['--git-dir', mirror, 'rev-parse', `refs/heads/${branch}`], LOCAL_TIMEOUT_MS, 'Branch missing after fetch')
    return stdout.trim()
  }

  async createBundle(url: string, branch: string, serverHead: string): Promise<BundleResult> {
    const mirror = this.mirrorPath(url)
    const file = join(tmpdir(), `shellway-${randomBytes(6).toString('hex')}.bundle`)
    const incremental = serverHead !== '' && (await this.hasCommit(mirror, serverHead))
    const range = incremental ? [`refs/heads/${branch}`, `^${serverHead}`] : [`refs/heads/${branch}`]
    await this.git(['--git-dir', mirror, 'bundle', 'create', file, ...range], LOCAL_TIMEOUT_MS, 'Could not package the code')
    return { file, full: !incremental }
  }

  async drift(url: string, branch: string, live: string): Promise<{ head: string; behind: number | null }> {
    const head = await this.lsRemote(url, branch)
    if (head === live) return { head, behind: 0 }
    if (!COMMIT_SHA.test(live)) return { head, behind: null }
    await this.fetch(url, branch)
    const mirror = this.mirrorPath(url)
    if (!(await this.hasCommit(mirror, live))) return { head, behind: null }
    const { stdout } = await this.git(['--git-dir', mirror, 'rev-list', '--count', `${live}..${head}`], LOCAL_TIMEOUT_MS, 'Could not count commits')
    return { head, behind: Number.parseInt(stdout.trim(), 10) }
  }

  async preview(request: PreviewRequest): Promise<ShipPreview> {
    const mirror = this.mirrorPath(request.url)
    const to = await this.previewTarget(request, mirror)
    const from = (await this.hasCommit(mirror, request.live)) ? request.live : ''
    const range = from ? `${from}..${to}` : to
    const limit = from ? PREVIEW_COMMIT_CAP : 1
    const [commits, totalCommits, files] = await Promise.all([
      this.previewCommits(mirror, range, limit, request.migrationsPath),
      from ? this.countCommits(mirror, range) : Promise.resolve(1),
      this.previewFiles(mirror, from, to, request.migrationsPath)
    ])
    return makeShipPreview({
      from,
      to,
      branch: request.branch,
      commits,
      files: orderFiles(files).slice(0, PREVIEW_FILE_CAP),
      totalCommits,
      totalFiles: files.length
    })
  }

  async inspect(url: string, branch: string): Promise<RepoFiles> {
    await this.fetch(url, branch)
    const mirror = this.mirrorPath(url)
    const ref = `refs/heads/${branch}`
    const { stdout } = await this.git(['--git-dir', mirror, '-c', 'core.quotepath=off', 'ls-tree', '--name-only', ref], LOCAL_TIMEOUT_MS, 'Could not list the repository files')
    const files = stdout.split('\n').filter(Boolean).slice(0, ROOT_FILE_CAP)
    const [packageJson, composerJson, envExample] = await Promise.all(READ_FILES.map((name) => (files.includes(name) ? this.readFile(mirror, `${ref}:${name}`) : null)))
    return { files, packageJson, composerJson, envExample }
  }

  async remoteHeads(url: string): Promise<string[]> {
    this.assertUrl(url)
    const { stdout } = await this.git([...this.protocols, 'ls-remote', '--heads', '--', url], NETWORK_TIMEOUT_MS, 'Could not reach the repository')
    return stdout.split('\n').filter(Boolean).map((line) => line.split('\t')[1] ?? '')
  }

  async commitProject(dir: string, branch: string, message: string): Promise<string> {
    if (!isValidBranch(branch)) throw new Error('Branch name is not valid')
    await this.git(['init', '-q', dir], LOCAL_TIMEOUT_MS, 'Could not start a git repository')
    await this.git(['-C', dir, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`], LOCAL_TIMEOUT_MS, 'Could not name the branch')
    await this.git(['-C', dir, 'add', '-A'], LOCAL_TIMEOUT_MS, 'Could not add the project files')
    try {
      await this.git(['-C', dir, 'commit', '-q', '--no-verify', '-m', message], LOCAL_TIMEOUT_MS, 'Could not commit the project')
    } catch (err) {
      if (NO_IDENTITY.test((err as Error).message)) throw new Error('git on this PC has no name and email yet. Run git config --global user.name and user.email, then Retry.')
      throw err
    }
    const { stdout } = await this.git(['-C', dir, 'rev-parse', 'HEAD'], LOCAL_TIMEOUT_MS, 'Could not read the commit')
    return stdout.trim()
  }

  async pushProject(dir: string, url: string, branch: string): Promise<void> {
    this.assertRemote(url, branch)
    await this.git([...this.protocols, '-C', dir, 'push', '-q', '--', url, `HEAD:refs/heads/${branch}`], NETWORK_TIMEOUT_MS, 'Could not push the project')
    await this.git(['-C', dir, 'remote', 'add', 'origin', url], LOCAL_TIMEOUT_MS, 'Could not set the remote')
    await this.git(['-C', dir, 'config', `branch.${branch}.remote`, 'origin'], LOCAL_TIMEOUT_MS, 'Could not set the upstream')
    await this.git(['-C', dir, 'config', `branch.${branch}.merge`, `refs/heads/${branch}`], LOCAL_TIMEOUT_MS, 'Could not set the upstream')
  }

  async isAncestor(url: string, ancestor: string, descendant: string): Promise<boolean> {
    if (!COMMIT_SHA.test(ancestor) || !COMMIT_SHA.test(descendant)) return false
    return this.succeeds(['--git-dir', this.mirrorPath(url), 'merge-base', '--is-ancestor', ancestor, descendant])
  }

  private async previewTarget(request: PreviewRequest, mirror: string): Promise<string> {
    if (await this.hasCommit(mirror, request.pending)) return request.pending
    return this.fetch(request.url, request.branch)
  }

  private async readFile(mirror: string, object: string): Promise<string | null> {
    const size = await this.git(['--git-dir', mirror, 'cat-file', '-s', object], LOCAL_TIMEOUT_MS, 'Could not read a repository file')
    if (Number(size.stdout.trim()) > READ_FILE_CAP) return null
    const { stdout } = await this.git(['--git-dir', mirror, 'cat-file', 'blob', object], LOCAL_TIMEOUT_MS, 'Could not read a repository file')
    return stdout
  }

  private async countCommits(mirror: string, range: string): Promise<number> {
    const { stdout } = await this.git(['--git-dir', mirror, 'rev-list', '--count', range], LOCAL_TIMEOUT_MS, 'Could not count commits')
    return Number.parseInt(stdout.trim(), 10)
  }

  private async previewCommits(mirror: string, range: string, limit: number, migrationsPath: string): Promise<ShipCommit[]> {
    const count = String(limit)
    const log = await this.git(['--git-dir', mirror, 'log', '-n', count, '--format=%H%x09%at%x09%an%x09%s', range, '--'], LOCAL_TIMEOUT_MS, 'Could not read the commits')
    const migrations = migrationsPath
      ? await this.git(['--git-dir', mirror, 'log', '-n', count, '--format=%H', range, '--', migrationsPath], LOCAL_TIMEOUT_MS, 'Could not read the commits')
      : { stdout: '' }
    return parseCommitLog(log.stdout, new Set(migrations.stdout.split('\n').filter(Boolean)))
  }

  private async previewFiles(mirror: string, from: string, to: string, migrationsPath: string): Promise<ShipFile[]> {
    const base = from || (await this.parentOf(mirror, to))
    const { stdout } = await this.git(['--git-dir', mirror, '-c', 'core.quotepath=off', ...diffCommand(base, to)], LOCAL_TIMEOUT_MS, 'Could not read the changed files')
    return parseDiff(stdout, migrationsPath)
  }

  private async parentOf(mirror: string, sha: string): Promise<string> {
    const { stdout } = await this.git(['--git-dir', mirror, 'rev-list', '--parents', '-n', '1', sha], LOCAL_TIMEOUT_MS, 'Could not read the commit')
    return stdout.trim().split(' ')[1] ?? ''
  }

  private hasCommit(mirror: string, sha: string): Promise<boolean> {
    if (!COMMIT_SHA.test(sha)) return Promise.resolve(false)
    return this.succeeds(['--git-dir', mirror, 'cat-file', '-e', `${sha}^{commit}`])
  }

  private async succeeds(args: string[]): Promise<boolean> {
    try {
      await run('git', args, { timeout: LOCAL_TIMEOUT_MS })
      return true
    } catch {
      return false
    }
  }

  private assertUrl(url: string): void {
    if (url.startsWith('-')) throw new Error('Repository URL is not valid')
    if (!this.options.allowLocalRepos && !REMOTE_URL.test(url)) throw new Error('Only https:// or ssh repository URLs can be deployed from this PC')
  }

  private assertRemote(url: string, branch: string): void {
    this.assertUrl(url)
    if (!isValidBranch(branch)) throw new Error('Branch name is not valid')
  }

  private mirrorPath(url: string): string {
    return join(this.cacheDir, `${createHash('sha256').update(url).digest('hex').slice(0, 16)}.git`)
  }

  private async git(args: string[], timeout: number, fallback: string): Promise<{ stdout: string }> {
    try {
      return await run('git', args, { timeout, env: gitEnv(), maxBuffer: 8 * 1024 * 1024 })
    } catch (err) {
      throw gitError(err, fallback)
    }
  }
}
