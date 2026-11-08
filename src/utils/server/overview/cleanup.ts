import type { ActionDefinition, ActionPlan, ActionStep, PlanBlock, ProbeDefinition, ServerFacts } from '@/types/server/core'
import { APT_ENV, APT_GET } from '../apt'
import { formatSize, keyValueLines, toNumber } from './format'
import { APT_CLEAN_ACTION, AUTOREMOVE_ACTION, CLEANUP_PROBE, JOURNAL_VACUUM_ACTION } from './ids'
import { validateNoParams } from './params'

export interface PackageSize {
  name: string
  sizeBytes: number
}

export interface AptCleanup {
  cacheBytes: number
  autoremove: PackageSize[]
}

export interface CleanupInfo {
  apt: AptCleanup | null
  journalBytes: number | null
}

const CLEANUP_SCRIPT = [
  'export LC_ALL=C PATH="$PATH:/usr/local/sbin:/usr/sbin:/sbin"',
  'if command -v apt-get >/dev/null 2>&1; then',
  '  echo "apt_cache=$(du -sk /var/cache/apt 2>/dev/null | cut -f1)"',
  "  pkgs=$(apt-get -s autoremove --purge 2>/dev/null | awk '/^(Remv|Purg) /{print $2}')",
  '  echo "@@autoremove"',
  "  [ -n \"$pkgs\" ] && dpkg-query -W -f='${Installed-Size} ${Package}\\n' $pkgs 2>/dev/null",
  '  echo "@@end"',
  'fi',
  'if command -v journalctl >/dev/null 2>&1; then echo "journal=$(journalctl --disk-usage 2>/dev/null)"; fi',
  'exit 0',
  ''
].join('\n')

const JOURNAL_UNITS: Record<string, number> = { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }

export function parseJournalUsage(line: string): number | null {
  const match = /take up ([\d.]+)\s*([BKMGT])?/.exec(line)
  if (!match) return null
  return Math.round(Number(match[1]) * JOURNAL_UNITS[match[2] ?? 'B'])
}

function parsePackageSizes(lines: string[]): PackageSize[] {
  return lines.flatMap((line) => {
    const [size, name] = line.trim().split(/\s+/)
    const kib = toNumber(size)
    return name && kib !== null ? [{ name, sizeBytes: kib * 1024 }] : []
  })
}

function sectionLines(stdout: string, start: string, end: string): string[] | null {
  const lines = stdout.split('\n')
  const from = lines.indexOf(start)
  if (from < 0) return null
  const to = lines.indexOf(end, from)
  return lines.slice(from + 1, to < 0 ? undefined : to)
}

export function parseCleanup(stdout: string): CleanupInfo {
  const values = keyValueLines(stdout)
  const autoremove = sectionLines(stdout, '@@autoremove', '@@end')
  const apt = autoremove === null ? null : { cacheBytes: (toNumber(values.get('apt_cache')) ?? 0) * 1024, autoremove: parsePackageSizes(autoremove) }
  const journal = values.get('journal')
  return { apt, journalBytes: journal === undefined ? null : parseJournalUsage(journal) }
}

export const cleanupProbe: ProbeDefinition<CleanupInfo> = {
  id: CLEANUP_PROBE,
  area: 'overview',
  root: true,
  timeoutSeconds: 60,
  script: CLEANUP_SCRIPT,
  parse: parseCleanup
}

export const JOURNAL_KEEP = '200M'
export const JOURNAL_KEEP_BYTES = 200 * 1024 ** 2

export const APT_CLEAN_COMMAND = 'apt-get clean'
export const AUTOREMOVE_COMMAND = `${APT_GET} autoremove --purge`
export const JOURNAL_VACUUM_COMMAND = `journalctl --vacuum-size=${JOURNAL_KEEP}`

export const autoremoveBytes = (packages: PackageSize[]): number => packages.reduce((sum, pkg) => sum + pkg.sizeBytes, 0)

export const journalSavings = (journalBytes: number): number => Math.max(0, journalBytes - JOURNAL_KEEP_BYTES)

type CleanupRead = { info: CleanupInfo; block: null } | { info: null; block: PlanBlock }

function readCleanup(facts: ServerFacts): CleanupRead {
  const result = facts[CLEANUP_PROBE]
  if (result?.status === 'ok') return { info: result.data as CleanupInfo, block: null }
  const reason = result?.status === 'unavailable' ? result.reason : result?.status === 'error' ? result.error : 'The cleanup check has not run yet.'
  return { info: null, block: { kind: 'precondition', message: reason } }
}

const APT_MISSING: PlanBlock = { kind: 'unsupported', message: 'This server does not use apt.' }

function commandStep(id: string, label: string, script: string, display: string, extra: Partial<ActionStep> = {}): ActionStep {
  return { id, label, kind: 'command', root: true, script, display, timeoutSeconds: 120, ...extra }
}

function cleanupPlan(title: string, summary: string, step: ActionStep, blocked: PlanBlock | null, warnings: string[] = []): ActionPlan {
  return { title, area: 'overview', summary, steps: [step], warnings, blocked, secrets: [] }
}

export function aptCleanPlan(_params: unknown, facts: ServerFacts): ActionPlan {
  const { info, block } = readCleanup(facts)
  const apt = info?.apt
  const size = apt ? ` Frees about ${formatSize(apt.cacheBytes)}.` : ''
  const step = commandStep('apt-clean', 'Delete downloaded package files', `${APT_CLEAN_COMMAND}\n`, APT_CLEAN_COMMAND)
  return cleanupPlan('Clear the package cache', `Deletes package files apt downloaded to /var/cache/apt. Installed software is not touched.${size}`, step, block ?? (apt ? null : APT_MISSING))
}

function autoremoveBlock(info: CleanupInfo | null, block: PlanBlock | null): PlanBlock | null {
  if (block) return block
  if (!info?.apt) return APT_MISSING
  return info.apt.autoremove.length === 0 ? { kind: 'precondition', message: 'No unused packages to remove.' } : null
}

export function autoremovePlan(_params: unknown, facts: ServerFacts): ActionPlan {
  const { info, block } = readCleanup(facts)
  const packages = info?.apt?.autoremove ?? []
  const names = packages.map((pkg) => pkg.name).join(', ')
  const summary = packages.length === 0
    ? 'Removes packages that were installed as dependencies and nothing needs anymore.'
    : `Removes ${packages.length} package${packages.length === 1 ? '' : 's'} nothing needs anymore, with their config files: ${names}. Frees about ${formatSize(autoremoveBytes(packages))}.`
  const script = ['set -e', APT_ENV, AUTOREMOVE_COMMAND, ''].join('\n')
  const step = commandStep('apt-autoremove', 'Remove unused packages', script, AUTOREMOVE_COMMAND, { detached: true, timeoutSeconds: 900 })
  const warnings = ['apt decides the final list when it runs. It matches this list unless packages changed since the check.']
  return cleanupPlan('Remove unused packages', summary, step, autoremoveBlock(info, block), warnings)
}

function journalBlock(info: CleanupInfo | null, block: PlanBlock | null): PlanBlock | null {
  if (block) return block
  if (info?.journalBytes === null || info?.journalBytes === undefined) return { kind: 'unsupported', message: 'This server has no systemd journal.' }
  return info.journalBytes <= JOURNAL_KEEP_BYTES ? { kind: 'precondition', message: 'System logs already use less than 200 MB.' } : null
}

export function journalVacuumPlan(_params: unknown, facts: ServerFacts): ActionPlan {
  const { info, block } = readCleanup(facts)
  const savings = info?.journalBytes ? ` Frees up to about ${formatSize(journalSavings(info.journalBytes))}.` : ''
  const step = commandStep('journal-vacuum', 'Trim old system logs', `${JOURNAL_VACUUM_COMMAND}\n`, JOURNAL_VACUUM_COMMAND)
  return cleanupPlan('Trim old system logs', `Deletes the oldest archived system logs until all logs fit in 200 MB. Recent logs stay.${savings}`, step, journalBlock(info, block))
}

const cleanupAction = (type: string, plan: (params: unknown, facts: ServerFacts) => ActionPlan): ActionDefinition<Record<string, never>> => ({
  type,
  area: 'overview',
  needs: [CLEANUP_PROBE],
  validate: validateNoParams,
  plan
})

export const cleanupActions: ActionDefinition<Record<string, never>>[] = [
  cleanupAction(APT_CLEAN_ACTION, aptCleanPlan),
  cleanupAction(AUTOREMOVE_ACTION, autoremovePlan),
  cleanupAction(JOURNAL_VACUUM_ACTION, journalVacuumPlan)
]
