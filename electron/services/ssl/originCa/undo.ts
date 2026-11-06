import type { ActionResult, SwitchLeftover, SwitchResult, SwitchStage, SwitchVerifyName } from '../../../../src/types/ssl'
import { undonePath } from '../../../../src/utils/ssl/originCa/originPaths'
import { EXIT_NGINX_TEST, EXIT_REFUSED, EXIT_RELOAD, undoScript } from '../../../../src/utils/ssl/originCa/scripts'
import type { RemoteExec } from '../../deploy/DeployService'
import type { OutputSink } from '../SslService'
import { RemoteRunner, SCRIPT_TIMEOUT_MS, SUDO_SCRIPT } from './remoteRun'
import { servedAsExpected, verifyServed } from './verifyServed'
import type { VerifyDeps } from './verifyServed'

export interface UndoDeps extends VerifyDeps {
  exec: RemoteExec
  onOutput: OutputSink
  now: () => number
}

export interface UndoTarget {
  file: string
  names: string[]
  prefix: string
  leftover: SwitchLeftover
}

const REMOVE_TIMEOUT_MS = 120_000

export async function runUndo(deps: UndoDeps, target: UndoTarget): Promise<SwitchResult> {
  const runner = new RemoteRunner(deps.exec, deps.onOutput)
  const backupPath = target.leftover.backupPath!
  const savePath = undonePath(target.prefix, Math.floor(deps.now() / 1000))
  const script = undoScript({ file: target.file, backupPath, savePath })
  const ran = await runner.run(SUDO_SCRIPT, SCRIPT_TIMEOUT_MS, { stdin: script, shown: `put ${backupPath} back as ${target.file}, test and reload nginx` })
  const finish = (ok: boolean, failedStage: SwitchStage | null, restored: boolean, verify: SwitchVerifyName[] = []): SwitchResult =>
    ({ ok, failedStage, restored, backupPath, output: runner.log.text(), verify })

  if (ran.code === EXIT_REFUSED) return finish(false, 'apply', false)
  if (ran.code === EXIT_NGINX_TEST) return finish(false, 'nginx-test', true)
  if (ran.code === EXIT_RELOAD) return finish(false, 'apply', true)
  if (ran.code !== 0) {
    runner.note(`Could not confirm the state of ${target.file}. Your copy from before the undo is at ${savePath}.`)
    return finish(false, 'apply', false)
  }
  const verify = await verifyServed(deps, target.names, false)
  if (servedAsExpected(verify, false)) return finish(true, null, false, verify)
  runner.note('nginx is still serving the Cloudflare Origin CA certificate.')
  return finish(false, 'verify', false, verify)
}

export async function runLineageRemoval(exec: RemoteExec, lineage: string, onOutput: OutputSink): Promise<ActionResult> {
  const runner = new RemoteRunner(exec, onOutput)
  const command = `sudo -n certbot delete --cert-name ${lineage} --non-interactive`
  const limited = command.replace(/^sudo -n /, 'sudo -n timeout -k 10 90 ')
  const done = await runner.run(limited, REMOVE_TIMEOUT_MS, { shown: command })
  return { code: done.code ?? 1, output: runner.log.text() }
}
