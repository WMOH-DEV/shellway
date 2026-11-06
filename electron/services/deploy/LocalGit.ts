import { execFile } from 'child_process'
import { createHash, randomBytes } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { isValidBranch } from './siteFiles'

const run = promisify(execFile)
const NETWORK_TIMEOUT_MS = 120_000
const LOCAL_TIMEOUT_MS = 60_000
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes' }
const REMOTE_PROTOCOLS = ['https', 'ssh', 'git'].flatMap((name) => ['-c', `protocol.${name}.allow=always`])
const REMOTE_URL = /^(https:\/\/|ssh:\/\/|git:\/\/|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:)[^\s]+$/
const COMMIT_SHA = /^[0-9a-f]{40,64}$/

export interface BundleResult {
  file: string
  full: boolean
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

  async isAncestor(url: string, ancestor: string, descendant: string): Promise<boolean> {
    if (!COMMIT_SHA.test(ancestor) || !COMMIT_SHA.test(descendant)) return false
    return this.succeeds(['--git-dir', this.mirrorPath(url), 'merge-base', '--is-ancestor', ancestor, descendant])
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

  private assertRemote(url: string, branch: string): void {
    if (url.startsWith('-')) throw new Error('Repository URL is not valid')
    if (!this.options.allowLocalRepos && !REMOTE_URL.test(url)) throw new Error('Only https:// or ssh repository URLs can be deployed from this PC')
    if (!isValidBranch(branch)) throw new Error('Branch name is not valid')
  }

  private mirrorPath(url: string): string {
    return join(this.cacheDir, `${createHash('sha256').update(url).digest('hex').slice(0, 16)}.git`)
  }

  private async git(args: string[], timeout: number, fallback: string): Promise<{ stdout: string }> {
    try {
      return await run('git', args, { timeout, env: GIT_ENV, maxBuffer: 8 * 1024 * 1024 })
    } catch (err) {
      throw gitError(err, fallback)
    }
  }
}
