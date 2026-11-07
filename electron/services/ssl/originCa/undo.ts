import type { ActionResult, SwitchLeftover, SwitchResult, SwitchStage, SwitchVerifyName } from '../../../../src/types/ssl'
import { undonePath } from '../../../../src/utils/ssl/originCa/originPaths'
import { EXIT_NGINX_TEST, EXIT_REFUSED, EXIT_RELOAD, EXIT_RESTORED, restoreIfChangedScript, undoScript } from '../../../../src/utils/ssl/originCa/scripts'
import type { WebServerDriver } from '../../../../src/utils/webServer'
import { shellEscape } from '../../../utils/shellEscape'
import type { RemoteExec } from '../../deploy/DeployService'
import type { OutputSink } from '../SslService'
import { RemoteRunner, SCRIPT_TIMEOUT_MS, SHORT_TIMEOUT_MS, SUDO_SCRIPT } from './remoteRun'
import { servedAsExpected, verifyServed } from './verifyServed'
import type { VerifyDeps } from './verifyServed'

export interface UndoDeps extends VerifyDeps {
  exec: RemoteExec
  onOutput: OutputSink
  now: () => number
}

export type RevokePlan = { revoke: (pem: string) => Promise<string | null> } | { skipReason: string } | null

export interface UndoTarget {
  driver: WebServerDriver
  file: string
  certPath: string
  names: string[]
  prefix: string
  leftover: SwitchLeftover
  revokePlan: RevokePlan
}

export const REVOKE_BY_HAND = 'Revoke it in Cloudflare → SSL/TLS → Origin Server.'

const REMOVE_TIMEOUT_MS = 120_000

class UndoRun {
  private readonly runner: RemoteRunner
  private readonly backupPath: string
  private readonly savePath: string

  constructor(private readonly deps: UndoDeps, private readonly target: UndoTarget) {
    this.runner = new RemoteRunner(deps.exec, deps.onOutput)
    this.backupPath = target.leftover.backupPath!
    this.savePath = undonePath(target.prefix, Math.floor(deps.now() / 1000))
  }

  async execute(): Promise<SwitchResult> {
    const pem = this.target.revokePlan !== null && 'revoke' in this.target.revokePlan ? await this.readCertificate() : null
    const result = await this.restore()
    if (result.ok) await this.revoke(pem)
    return { ...result, output: this.runner.log.text() }
  }

  private async readCertificate(): Promise<string | null> {
    const read = await this.runner.run(`sudo -n cat ${shellEscape(this.target.certPath)}`, SHORT_TIMEOUT_MS, { stream: false })
    return read.code === 0 && read.stdout.includes('BEGIN CERTIFICATE') ? read.stdout : null
  }

  private async revoke(pem: string | null): Promise<void> {
    const plan = this.target.revokePlan
    if (plan === null) return
    if ('skipReason' in plan) return this.runner.note(plan.skipReason)
    if (pem === null) return this.runner.note(`Could not read ${this.target.certPath}, so the certificate was not revoked in Cloudflare. ${REVOKE_BY_HAND}`)
    try {
      const id = await plan.revoke(pem)
      this.runner.note(id ? `Revoked the Cloudflare Origin CA certificate (${id}).` : `Cloudflare has no Origin CA certificate matching ${this.target.certPath}, so nothing was revoked.`)
    } catch (err) {
      this.runner.note(`Could not revoke the certificate in Cloudflare: ${(err as Error).message} ${REVOKE_BY_HAND}`)
    }
  }

  private async restore(): Promise<SwitchResult> {
    const script = undoScript({ driver: this.target.driver, file: this.target.file, backupPath: this.backupPath, savePath: this.savePath })
    const ran = await this.runner.run(SUDO_SCRIPT, SCRIPT_TIMEOUT_MS, { stdin: script, shown: `put ${this.backupPath} back as ${this.target.file}, test and reload ${this.target.driver.label}` })
    if (ran.code === 0) return this.verify()
    if (ran.code === EXIT_REFUSED) return this.finish(false, 'apply', false)
    if (ran.code === EXIT_NGINX_TEST) return this.finish(false, 'nginx-test', true)
    if (ran.code === EXIT_RELOAD) return this.finish(false, 'apply', true)
    return this.settle()
  }

  private async verify(): Promise<SwitchResult> {
    const verify = await verifyServed(this.deps, this.target.names, false)
    if (servedAsExpected(verify, false)) return this.finish(true, null, false, verify)
    this.runner.note(`${this.target.driver.label} is still serving the Cloudflare Origin CA certificate.`)
    return this.finish(false, 'verify', false, verify)
  }

  private async settle(): Promise<SwitchResult> {
    const script = restoreIfChangedScript({ driver: this.target.driver, file: this.target.file, backupPath: this.savePath })
    const settled = await this.runner.run(SUDO_SCRIPT, SCRIPT_TIMEOUT_MS, { stdin: script, shown: 'check whether the site file was changed and put the version from before the undo back if so' })
    if (settled.code === EXIT_RESTORED) return this.finish(false, 'apply', true)
    if (settled.code === 0) return this.finish(false, 'apply', false)
    this.runner.note(`Could not confirm the state of ${this.target.file}. Your copy from before the undo is at ${this.savePath}.`)
    return this.finish(false, 'apply', false)
  }

  private finish(ok: boolean, failedStage: SwitchStage | null, restored: boolean, verify: SwitchVerifyName[] = []): SwitchResult {
    return { ok, failedStage, restored, backupPath: this.backupPath, output: this.runner.log.text(), verify }
  }
}

export function runUndo(deps: UndoDeps, target: UndoTarget): Promise<SwitchResult> {
  return new UndoRun(deps, target).execute()
}

export async function runLineageRemoval(exec: RemoteExec, lineage: string, onOutput: OutputSink): Promise<ActionResult> {
  const runner = new RemoteRunner(exec, onOutput)
  const command = `sudo -n certbot delete --cert-name ${lineage} --non-interactive`
  const limited = command.replace(/^sudo -n /, 'sudo -n timeout -k 10 90 ')
  const done = await runner.run(limited, REMOVE_TIMEOUT_MS, { shown: command })
  return { code: done.code ?? 1, output: runner.log.text() }
}
