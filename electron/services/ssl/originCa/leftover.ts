import type { CertbotLineage, ServerBlock, SslReport, SwitchLeftover } from '../../../../src/types/ssl'
import { isIssuableName } from '../../../../src/utils/ssl/https/issueCommands'
import { backupGlob, newestBackup } from '../../../../src/utils/ssl/originCa/originPaths'
import type { RemoteExec } from '../../deploy/DeployService'
import { RemoteRunner, SHORT_TIMEOUT_MS, SUDO_SHELL } from './remoteRun'

export interface LeftoverTarget {
  block: ServerBlock
  lineage: CertbotLineage
  prefix: string
}

const liveDir = (lineage: string): string => `/etc/letsencrypt/live/${lineage}/`

export const blocksUsingLineage = (blocks: ServerBlock[], lineage: string): ServerBlock[] =>
  blocks.filter((block) => block.certPath.startsWith(liveDir(lineage)) || block.keyPath.startsWith(liveDir(lineage)))

export function leftoverTarget(report: SslReport, name: string): LeftoverTarget | null {
  const host = report.hostnames.find((h) => h.name.toLowerCase() === name.toLowerCase())
  if (!host || host.origin?.kind !== 'cloudflare-origin' || host.lineage === null) return null
  const block = report.blocks.find((b) => b.id === host.blockId)
  const lineage = report.lineages.find((l) => l.name === host.lineage)
  const prefix = block?.names[0]?.toLowerCase() ?? ''
  if (!block || !lineage || !isIssuableName(prefix)) return null
  return { block, lineage, prefix }
}

async function newestBackupOnServer(exec: RemoteExec, prefix: string): Promise<string | null> {
  const runner = new RemoteRunner(exec, () => {})
  const script = `for f in ${backupGlob(prefix)}; do [ -f "$f" ] && echo "$f"; done; true\n`
  const listed = await runner.run(SUDO_SHELL, SHORT_TIMEOUT_MS, { stdin: script, stream: false })
  return listed.code === 0 ? newestBackup(listed.stdout, prefix) : null
}

export async function readLeftover(exec: RemoteExec, report: SslReport, name: string, nowSeconds: number): Promise<SwitchLeftover | null> {
  const target = leftoverTarget(report, name)
  if (!target) return null
  const { block, lineage, prefix } = target
  const backupPath = await newestBackupOnServer(exec, prefix)
  const stillValid = lineage.notAfter !== null && lineage.notAfter > nowSeconds
  return {
    name,
    blockId: block.id,
    lineage: lineage.name,
    lineageShared: blocksUsingLineage(report.blocks.filter((b) => b.id !== block.id), lineage.name).length > 0,
    backupPath,
    undoable: backupPath !== null && stillValid
  }
}

export function undoRefusal(leftover: SwitchLeftover | null): string | null {
  if (!leftover) return 'This site is not using a Cloudflare Origin CA certificate that Shellway switched it to.'
  if (leftover.backupPath === null) return 'The backup of the original site file is gone, so the switch cannot be undone.'
  if (!leftover.undoable) return 'The Let\'s Encrypt certificate it would go back to has expired, so the switch cannot be undone.'
  return null
}
