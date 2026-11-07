import type { SwitchPrepared, SwitchResult, SwitchStage, SwitchVerifyName } from '../../../../src/types/ssl'
import {
  EXIT_NGINX_TEST, EXIT_REFUSED, EXIT_RELOAD, EXIT_RESTORED, removeFilesCommand, restoreIfChangedScript, restoreScript
} from '../../../../src/utils/ssl/originCa/scripts'
import { webServerDriver } from '../../../../src/utils/webServer'
import type { RemoteExec } from '../../deploy/DeployService'
import type { OutputSink } from '../SslService'
import { RemoteRunner, SCRIPT_TIMEOUT_MS, SHORT_TIMEOUT_MS, SUDO_SCRIPT } from './remoteRun'
import { httpsAcceptable, servedAsExpected, verifyServed } from './verifyServed'
import type { VerifyDeps } from './verifyServed'

export interface ApplyDeps extends VerifyDeps {
  exec: RemoteExec
  onOutput: OutputSink
}

class ApplyRun {
  private readonly runner: RemoteRunner

  constructor(private readonly deps: ApplyDeps, private readonly prepared: SwitchPrepared) {
    this.runner = new RemoteRunner(deps.exec, deps.onOutput)
  }

  async execute(): Promise<SwitchResult> {
    const ran = await this.runner.run(SUDO_SCRIPT, SCRIPT_TIMEOUT_MS, { stdin: this.prepared.script, shown: 'run the reviewed switch script as root' })
    if (ran.code === 0) return this.verify()
    if (ran.code === EXIT_REFUSED) return this.unchanged('apply')
    if (ran.code === EXIT_NGINX_TEST) return this.putBack('nginx-test')
    if (ran.code === EXIT_RELOAD) return this.putBack('apply')
    return this.settle()
  }

  private async verify(): Promise<SwitchResult> {
    const names = this.prepared.names
    const results = await verifyServed(this.deps, names, true)
    if (servedAsExpected(results, true) && httpsAcceptable(results)) return this.result(true, null, false, results)
    this.runner.note(this.verifyProblem(results))
    this.runner.note('Putting the original site file back.')
    const restored = await this.restore()
    if (restored) await this.discard()
    return this.result(false, 'verify', restored, results, true)
  }

  private verifyProblem(results: SwitchVerifyName[]): string {
    const wrong = results.find((r) => r.served === null || r.served.error !== null || r.served.kind !== 'cloudflare-origin')
    if (wrong) return `${wrong.name} is not serving the new Cloudflare Origin CA certificate.`
    const refused = results.find((r) => r.https.state === 'fail')
    return `${refused?.name}: ${refused?.https.detail}.`
  }

  private async restore(): Promise<boolean> {
    const script = restoreScript({ driver: this.driver(), file: this.prepared.file, backupPath: this.prepared.backupPath })
    const done = await this.runner.run(SUDO_SCRIPT, SCRIPT_TIMEOUT_MS, { stdin: script, shown: `put ${this.prepared.backupPath} back, test and reload ${this.driver().label}` })
    return done.code === 0
  }

  private async unchanged(stage: SwitchStage): Promise<SwitchResult> {
    await this.discard()
    return this.result(false, stage, false)
  }

  private async putBack(stage: SwitchStage): Promise<SwitchResult> {
    await this.discard()
    return this.result(false, stage, true)
  }

  private async settle(): Promise<SwitchResult> {
    const script = restoreIfChangedScript({ driver: this.driver(), file: this.prepared.file, backupPath: this.prepared.backupPath })
    const settled = await this.runner.run(SUDO_SCRIPT, SCRIPT_TIMEOUT_MS, { stdin: script, shown: 'check whether the site file was changed and put the original back if so' })
    if (settled.code === EXIT_RESTORED) return this.putBack('apply')
    if (settled.code === 0) return this.unchanged('apply')
    this.runner.note(`Could not confirm the state of ${this.prepared.file}. The original is saved at ${this.prepared.backupPath}.`)
    return this.result(false, 'apply', false, [], true)
  }

  private driver() {
    return webServerDriver(this.prepared.webServer, this.prepared.apacheLayout)
  }

  private async discard(): Promise<void> {
    await this.runner.run(removeFilesCommand(this.prepared.keyPath, this.prepared.certPath), SHORT_TIMEOUT_MS)
  }

  private result(ok: boolean, failedStage: SwitchStage | null, restored: boolean, verify: SwitchVerifyName[] = [], backupMayExist = ok || restored): SwitchResult {
    return { ok, failedStage, restored, backupPath: backupMayExist ? this.prepared.backupPath : null, output: this.runner.log.text(), verify }
  }
}

export function runApply(deps: ApplyDeps, prepared: SwitchPrepared): Promise<SwitchResult> {
  return new ApplyRun(deps, prepared).execute()
}
