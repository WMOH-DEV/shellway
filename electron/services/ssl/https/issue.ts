import { posix } from 'path'
import type { IssueRequest, IssueResult, IssueStage, ServerBlock } from '../../../../src/types/ssl'
import { issueCommand, issueRequestError, lineageFor, stagingCommand } from '../../../../src/utils/ssl/https/issueCommands'
import { CHANGE_NEEDS_FULL_READ, isFullyRead } from '../../../../src/utils/ssl/originCa/nginxRead'
import { renewalHint } from '../../../../src/utils/ssl/renewalHint'
import { shellEscape } from '../../../utils/shellEscape'
import type { ExecOptions } from '../../../utils/sshExec'
import type { RemoteExec } from '../../deploy/DeployService'
import type { OutputSink, ServerConfig } from '../SslService'
import { teeOutput } from './teeOutput'
import { servingDriver, type WebServerDriver } from '../../../../src/utils/webServer'
import type { OutputLog } from './teeOutput'

const BACKUP_DIR = '/etc/ssl/shellway/backups'
const CERTBOT_TIMEOUT_MS = 10 * 60_000
const SHORT_TIMEOUT_MS = 30_000
const REMOTE_LIMIT_S = CERTBOT_TIMEOUT_MS / 1000 - 30
const NEEDS_SUDO = 'Issuing a certificate needs passwordless sudo. Run these commands yourself, then Check again.'

export interface IssueHooks {
  now: () => number
  rememberEmail: () => void
  onOutput: OutputSink
}

function blockFor(request: IssueRequest, config: ServerConfig, driver: WebServerDriver): ServerBlock {
  if (!config.facts.sudo.full) throw new Error(NEEDS_SUDO)
  if (!isFullyRead(config.facts)) throw new Error(CHANGE_NEEDS_FULL_READ)
  const block = config.blocks.find((b) => b.id === request.blockId)
  if (!block) throw new Error(`This site is no longer in the ${driver.label} configuration. Check again.`)
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
    private readonly driver: WebServerDriver,
    private readonly hooks: IssueHooks
  ) {
    this.log = teeOutput(hooks.onOutput)
  }

  async execute(): Promise<IssueResult> {
    if (!(await this.backup())) return this.failure('backup', false)
    if (this.request.staging) {
      if (!(await this.runCertbot(stagingCommand(this.request, this.driver.kind)))) return this.failUnlessUnchanged('staging')
      this.rememberEmail()
    }
    const issued = await this.runCertbot(issueCommand(this.request, this.driver.kind))
    const tested = await this.run(this.sudo(this.driver.testCommand), SHORT_TIMEOUT_MS)
    if (issued && tested) return this.success()
    if (tested) return this.failUnlessUnchanged('issue')
    const restored = await this.restore()
    return this.failure(restored ? (issued ? 'nginx-test' : 'issue') : 'restore', restored)
  }

  private runCertbot(command: string): Promise<boolean> {
    const limited = command.replace(/^sudo -n /, `sudo -n timeout -k 10 ${REMOTE_LIMIT_S} `)
    return this.run(limited, CERTBOT_TIMEOUT_MS, {}, command)
  }

  private async failUnlessUnchanged(stage: IssueStage): Promise<IssueResult> {
    if (await this.matchesBackup()) return this.failure(stage, false)
    const restored = await this.restore()
    return this.failure(restored ? stage : 'restore', restored)
  }

  private matchesBackup(): Promise<boolean> {
    return this.run(`sudo -n cmp -s ${shellEscape(this.backupPath ?? '')} ${shellEscape(this.block.file)}`, SHORT_TIMEOUT_MS)
  }

  private rememberEmail(): void {
    try {
      this.hooks.rememberEmail()
    } catch (err) {
      this.log.write(`Could not remember the email: ${(err as Error).message}\n`)
    }
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
    if (!(await this.run(this.sudo(this.driver.testCommand), SHORT_TIMEOUT_MS))) return false
    return this.run(this.sudo(this.driver.reloadCommand), SHORT_TIMEOUT_MS)
  }

  private sudo(command: string): string {
    return `sudo -n ${command}`
  }

  private success(): IssueResult {
    this.rememberEmail()
    return { ok: true, failedStage: null, restored: false, backupPath: this.backupPath, lineage: lineageFor(this.request), output: this.log.text(), hint: null }
  }

  private failure(failedStage: IssueStage, restored: boolean): IssueResult {
    const output = this.log.text()
    return { ok: false, failedStage, restored, backupPath: this.backupPath, lineage: null, output, hint: renewalHint(output, { action: 'issue', webServer: 'nginx' }) }
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
  const config = await readConfig()
  const driver = servingDriver(config.facts)
  const block = blockFor(request, config, driver)
  return new IssueRun(exec, request, block, driver, hooks).execute()
}
