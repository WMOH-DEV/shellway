import type { ActionResult, DiffLine, OriginKeyType, OriginValidityYears, SslReport, SwitchCheck, SwitchResult, SwitchStage } from '../../../types/ssl'
import { formatDay } from '../time'
import { KEY_LABELS, validityLabel } from './steps'

export function certificateSummary(keyType: OriginKeyType, years: OriginValidityYears): string {
  return `Cloudflare Origin CA · ${KEY_LABELS[keyType]} · ${validityLabel(years)}`
}

export const validUntilText = (notAfter: number | null): string => (notAfter === null ? 'Unknown' : formatDay(notAfter, true))

export function diffCounts(diff: DiffLine[]): { added: number; removed: number } {
  return {
    added: diff.filter((line) => line.kind === 'add').length,
    removed: diff.filter((line) => line.kind === 'remove').length
  }
}

export interface NameRow {
  name: string
  ok: boolean
  detail: string
}

export function nameRows(report: SslReport, check: SwitchCheck): NameRow[] {
  const zones = new Map(report.hostnames.filter((host) => host.blockId === check.blockId).map((host) => [host.name.toLowerCase(), host.edge.zone]))
  return check.names.map(({ name, ok, reason }) => ({
    name,
    ok,
    detail: ok ? `proxied · zone ${zones.get(name.toLowerCase()) ?? 'unknown'}` : (reason ?? 'cannot be switched')
  }))
}

function failureTitle(stage: SwitchStage, server: string): string {
  const titles: Record<SwitchStage, string> = {
    apply: 'Applying the change failed',
    'nginx-test': `${server} rejected the changed file`,
    verify: 'The new certificate did not verify'
  }
  return titles[stage]
}

export interface SwitchFailureView {
  title: string
  note: string
}

function failureNote(result: SwitchResult, server: string): string {
  if (result.restored) return `Shellway restored the backup${result.backupPath ? ` (${result.backupPath})` : ''} and reloaded ${server}. The site is back on its old certificate.`
  if (result.backupPath === null) return 'Nothing on the server was changed. Check the output below.'
  return `The backup was not restored automatically. Your original file is at ${result.backupPath}. Check the output below.`
}

export function switchFailureView(result: SwitchResult, server: string): SwitchFailureView {
  return { title: failureTitle(result.failedStage ?? 'apply', server), note: failureNote(result, server) }
}

export interface RunOutcomeView {
  success: boolean
  message: string
}

const couldNotRun = (what: string, error: string): RunOutcomeView => ({ success: false, message: `${what} could not run: ${error}` })

export function applyOutcome(result: SwitchResult | null, error: string | null, server: string): RunOutcomeView | null {
  if (result) return { success: result.ok, message: result.ok ? 'Switched to Cloudflare Origin CA' : switchFailureView(result, server).title }
  return error ? couldNotRun('The switch', error) : null
}

export function undoOutcome(result: SwitchResult | null, error: string | null): RunOutcomeView | null {
  if (result) return { success: result.ok, message: result.ok ? 'Switch undone' : 'Undoing the switch failed' }
  return error ? couldNotRun('The undo', error) : null
}

export function removeOutcome(result: ActionResult | null, error: string | null): RunOutcomeView | null {
  if (result === null) return error ? couldNotRun('The removal', error) : null
  return result.code === 0 ? { success: true, message: 'certbot certificate removed' } : { success: false, message: `The removal failed (exit ${result.code})` }
}
