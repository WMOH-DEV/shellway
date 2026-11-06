import type { DeployRecord, ShipFile, ShipFileStatus, ShipPreview, SiteConfig, SiteSummary } from '@/types/deploy'
import { commitCount } from './siteRow'

export const COLLAPSED_FILE_ROWS = 6
export const AUTHOR_TONES = 4

export interface StageChip {
  id: 'fetch' | 'build' | 'activate' | 'after' | 'health'
  name: string
  detail: string
}

export interface FileDelta {
  added: string
  removed: string
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

export const fileCount = (count: number) => plural(count, 'file')

export function initials(author: string): string {
  const words = author.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

export function authorTone(author: string): number {
  let hash = 0
  for (const char of author) hash = (hash * 31 + char.codePointAt(0)!) % 9973
  return hash % AUTHOR_TONES
}

export function isUpToDate(preview: ShipPreview): boolean {
  return preview.totalCommits === 0
}

export function hasMigration(preview: ShipPreview): boolean {
  return preview.files.some((f) => f.migration) || preview.commits.some((c) => c.migration)
}

export function migrationCount(preview: ShipPreview): number {
  return preview.files.filter((f) => f.migration && f.status !== 'D').length
}

export function requiresReview(summary: SiteSummary, preview: ShipPreview): boolean {
  return summary.state.pending !== '' || (summary.config.approveMigrations && hasMigration(preview))
}

export function migrationCommand(config: SiteConfig): string {
  const step = [...config.buildSteps, ...config.activateSteps].find((s) => /\bmigrate\b/.test(s.command))
  return step?.command ?? ''
}

export function migrationHeadline(count: number): string {
  return count > 0 ? `This deploy adds ${plural(count, 'migration')}.` : 'This deploy includes database migrations.'
}

export function summaryLine(preview: ShipPreview): string {
  return isUpToDate(preview)
    ? 'Already up to date'
    : `${commitCount(preview.totalCommits)}, ${fileCount(preview.totalFiles)}`
}

export function deployLabel(preview: ShipPreview): string {
  return isUpToDate(preview) ? 'Redeploy' : `Deploy ${commitCount(preview.totalCommits)}`
}

export function truncationNote(preview: ShipPreview): string {
  if (!preview.truncated) return ''
  const parts: string[] = []
  if (preview.totalCommits > preview.commits.length) parts.push(`${preview.commits.length} of ${commitCount(preview.totalCommits)}`)
  if (preview.totalFiles > preview.files.length) parts.push(`${preview.files.length} of ${fileCount(preview.totalFiles)}`)
  return `Showing ${parts.join(' and ')}`
}

export function visibleFiles(files: ShipFile[], expanded: boolean): ShipFile[] {
  return expanded ? files : files.slice(0, COLLAPSED_FILE_ROWS)
}

export function fileDelta(file: Pick<ShipFile, 'added' | 'removed'>): FileDelta {
  if (file.added === null && file.removed === null) return { added: 'binary', removed: '' }
  return { added: file.added ? `+${file.added}` : '', removed: file.removed ? `−${file.removed}` : '' }
}

export const FILE_STATUS_LABELS: Record<ShipFileStatus, string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed'
}

function isRollbackCandidate(summary: SiteSummary, record: DeployRecord): boolean {
  if (record.trigger === 'env' || !record.commit) return false
  if (record.status !== 'success' && record.status !== 'warning') return false
  if (summary.config.layout === 'releases') return record.id !== summary.state.currentRelease
  return record.commit !== summary.state.current
}

export function rollbackCommit(summary: SiteSummary): string {
  if (!summary.state.current) return ''
  if (summary.config.layout === 'releases' && summary.config.keepReleases < 2) return ''
  return summary.history.find((r) => isRollbackCandidate(summary, r))?.commit ?? ''
}

function healthDetail(config: SiteConfig): string {
  try {
    const { pathname } = new URL(config.healthUrl)
    return `${pathname || '/'} · ${config.healthStatus}`
  } catch {
    return `${config.healthUrl} · ${config.healthStatus}`
  }
}

const commandsLabel = (count: number) => plural(count, 'command')

export function stageChips(config: SiteConfig): StageChip[] {
  const chips: StageChip[] = [{ id: 'fetch', name: 'Fetch', detail: config.sourceMode === 'pc' ? 'from this PC' : '' }]
  if (config.buildSteps.length > 0) chips.push({ id: 'build', name: 'Build', detail: commandsLabel(config.buildSteps.length) })
  chips.push({ id: 'activate', name: 'Go live', detail: config.layout === 'releases' ? 'switch' : 'in place' })
  if (config.activateSteps.length > 0) chips.push({ id: 'after', name: 'After going live', detail: commandsLabel(config.activateSteps.length) })
  if (config.healthUrl) chips.push({ id: 'health', name: 'Health check', detail: healthDetail(config) })
  return chips
}
