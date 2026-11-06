import type { ActionResult, InstallPlan, InstallRoute, PrepFacts } from '../../../../src/types/ssl'
import { installPlan, installScript } from '../../../../src/utils/ssl/https/installPlan'
import type { RemoteExec } from '../../deploy/DeployService'
import { detectPrep, PATH_LINE } from './prepFacts'
import type { OutputSink } from '../SslService'
import { teeOutput } from './teeOutput'

const INSTALL_TIMEOUT_MS = 15 * 60_000
const SCRIPT_END = 'SHELLWAY_INSTALL_END'
const NEEDS_SUDO = 'Installing needs passwordless sudo. Run these commands yourself, then Check again.'

function refusal(facts: PrepFacts, plan: InstallPlan, route: InstallRoute): string | null {
  if (plan.blockedReason) return plan.blockedReason
  if (plan.route !== route) return `The ${route} route is not available on this server.`
  return facts.fullSudo ? null : NEEDS_SUDO
}

function stdinScript(plan: InstallPlan): string {
  return `${PATH_LINE}\neval "$(cat <<'${SCRIPT_END}'\n${installScript(plan)}${SCRIPT_END}\n)"\n`
}

export async function runInstall(exec: RemoteExec, route: InstallRoute, onOutput: OutputSink): Promise<ActionResult> {
  const facts = await detectPrep(exec)
  const plan = installPlan(facts, route)
  const reason = refusal(facts, plan, route)
  if (reason) throw new Error(reason)
  const log = teeOutput(onOutput)
  const result = await exec('sudo -n sh -s', { stdin: stdinScript(plan), timeoutMs: INSTALL_TIMEOUT_MS, onOutput: log.write })
  return { code: result.code, output: log.text() }
}
