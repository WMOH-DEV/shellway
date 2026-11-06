import { posix } from 'path'
import type { IssueRequest, IssueResult, IssueStage, ServerBlock } from '../../../../src/types/ssl'
import { issueCommand, issueRequestError, lineageFor, stagingCommand } from '../../../../src/utils/ssl/https/issueCommands'
import { renewalHint } from '../../../../src/utils/ssl/renewalHint'
import { shellEscape } from '../../../utils/shellEscape'
import type { ExecOptions } from '../../../utils/sshExec'
import type { RemoteExec } from '../../deploy/DeployService'
import type { OutputSink, ServerConfig } from '../SslService'
import { teeOutput } from './teeOutput'
import type { OutputLog } from './teeOutput'

const BACKUP_DIR = '/etc/ssl/shellway/backups'
const NGINX_TEST = 'sudo -n nginx -t'
const NGINX_RELOAD = 'sudo -n nginx -s reload'
const CERTBOT_TIMEOUT_MS = 10 * 60_000
const SHORT_TIMEOUT_MS = 30_000
const NEEDS_SUDO = 'Issuing a certificate needs passwordless sudo. Run these commands yourself, then Check again.'
const SITE_GONE = 'This site is no longer in the nginx configuration. Check again.'

export interface IssueHooks {
  now: () => number
  rememberEmail: () => void
  onOutput: OutputSink
}

function blockFor(request: IssueRequest, config: ServerConfig): ServerBlock {
  if (!config.facts.sudo.full) throw new Error(NEEDS_SUDO)
  const block = config.blocks.find((b) => b.id === request.blockId)
  if (!block) throw new Error(SITE_GONE)
  const allowed = new Set(block.names.map((name) => name.toLowerCase()))
  const stranger = request.names.find((name) => !allowed.has(name))
  if (stranger !== undefined) throw new Error(`${stranger} is not a name of this site`)
  return block
}

class IssueRun {
  private readonly log: OutputLog
  private backupPath: string | null = null

  constructor(
    private readonly exec: RemoteExec,
    private readonly request: IssueRequest,
    private readonly block: ServerBlock,
    private readonly hooks: IssueHooks
  ) {
    this.log = teeOutput(hooks.onOutput)
  }

  async execute(): Promise<IssueResult> {
    if (!(await this.backup())) return this.failure('backup', false)
    if (this.request.staging) {
      if (!(await this.run(stagingCommand(this.request), CERTBOT_TIMEOUT_MS))) return this.failure('staging', false)
      this.hooks.rememberEmail()
    }
    const issued = await this.run(issueCommand(this.request), CERTBOT_TIMEOUT_MS)
    const tested = await this.run(NGINX_TEST, SHORT_TIMEOUT_MS)
    if (issued && tested) return this.success()
    if (tested) return this.failure('issue', false)
    const restored = await this.restore()
    return this.failure(restored ? (issued ? 'nginx-test' : 'issue') : 'restore', restored)
  }

  private async run(command: string, timeoutMs: number, options: ExecOptions = {}, shown = command): Promise<boolean> {
    this.log.write(`$ ${shown}\n`)
    try {
      const result = await this.exec(command, { ...options, timeoutMs, onOutput: this.log.write })
      return result.code === 0
    } catch (err) {
      this.log.write(`${(err as Error).message}\n`)
      return false
    }
  }

  private async backup(): Promise<boolean> {
    const path = `${BACKUP_DIR}/${posix.basename(this.block.file)}.${Math.floor(this.hooks.now() / 1000)}`
    const lines = [`mkdir -p -m 700 ${BACKUP_DIR}`, `cp -p ${shellEscape(this.block.file)} ${shellEscape(path)}`]
    const saved = await this.run('sudo -n sh -s', SHORT_TIMEOUT_MS, { stdin: `set -e\n${lines.join('\n')}\n` }, lines.join('\n$ '))
    if (saved) this.backupPath = path
    return saved
  }

  private async restore(): Promise<boolean> {
    if (this.backupPath === null) return false
    if (!(await this.run(`sudo -n cp -p ${shellEscape(this.backupPath)} ${shellEscape(this.block.file)}`, SHORT_TIMEOUT_MS))) return false
    if (!(await this.run(NGINX_TEST, SHORT_TIMEOUT_MS))) return false
    return this.run(NGINX_RELOAD, SHORT_TIMEOUT_MS)
  }

  private success(): IssueResult {
    this.hooks.rememberEmail()
    return { ok: true, failedStage: null, restored: false, backupPath: this.backupPath, lineage: lineageFor(this.request), output: this.log.text(), hint: null }
  }

  private failure(failedStage: IssueStage, restored: boolean): IssueResult {
    const output = this.log.text()
    return { ok: false, failedStage, restored, backupPath: this.backupPath, lineage: null, output, hint: renewalHint(output) }
  }
}

export async function runIssue(
  exec: RemoteExec,
  readConfig: () => Promise<ServerConfig>,
  request: IssueRequest,
  hooks: IssueHooks
): Promise<IssueResult> {
  const invalid = issueRequestError(request)
  if (invalid) throw new Error(invalid)
  const block = blockFor(request, await readConfig())
  return new IssueRun(exec, request, block, hooks).execute()
}
