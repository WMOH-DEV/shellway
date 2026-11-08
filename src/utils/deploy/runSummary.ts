import type { DeployRecord, SiteConfig } from '@/types/deploy'
import { STAGE_IDS, failedStep, type ParsedLog, type StageId } from './runLog'
import { formatSeconds, shortSha } from './siteStatus'

export type StageState = 'done' | 'warning' | 'failed' | 'running' | 'cancelled' | 'pending' | 'skipped'

export interface StageView {
  id: StageId
  label: string
  state: StageState
  seconds: number | null
}

export interface FailureView {
  command: string
  exitCode: number | null
  stageLabel: string
  outcome: string
  sectionKey: string | null
}

export const STAGE_LABELS: Record<StageId, string> = {
  fetch: 'Fetch',
  build: 'Build',
  golive: 'Go live',
  after: 'After live',
  health: 'Health'
}

const ACTIVATE_ONLY: ReadonlySet<StageId> = new Set(['golive', 'after', 'health'])
const AFTER_ONLY: ReadonlySet<StageId> = new Set(['after', 'health'])

function applicableStages(record: DeployRecord, config: SiteConfig): StageId[] {
  return STAGE_IDS.filter((id) => {
    if (id === 'health' && !config.healthUrl) return false
    if (id === 'golive' && config.layout === 'inplace') return false
    if (record.trigger === 'env') return AFTER_ONLY.has(id)
    if (record.trigger === 'rollback' && config.layout === 'releases') return ACTIVATE_ONLY.has(id)
    return true
  })
}

function lastStageState(record: DeployRecord, interrupted: boolean): StageState {
  if (interrupted) return 'failed'
  switch (record.status) {
    case 'running': return 'running'
    case 'failed':
    case 'reverted': return 'failed'
    case 'cancelled': return 'cancelled'
    default: return 'done'
  }
}

function stagesWithWarnings(parsed: ParsedLog): Set<StageId> {
  return new Set(parsed.sections
    .filter((s) => s.kind === 'step' && s.optional && s.exitCode !== null && s.exitCode !== 0 && s.stage)
    .map((s) => s.stage as StageId))
}

export function stageViews(parsed: ParsedLog, record: DeployRecord, config: SiteConfig, now: number, interrupted: boolean): StageView[] {
  if (!parsed.structured) return []
  const stages = applicableStages(record, config)
  const started = stages.filter((id) => parsed.stageStarts[id] !== undefined)
  const last = started[started.length - 1]
  const warned = stagesWithWarnings(parsed)
  const end = record.finished ?? now
  return stages.map((id) => {
    const start = parsed.stageStarts[id]
    if (start === undefined) return { id, label: STAGE_LABELS[id], state: record.status === 'running' && !interrupted ? 'pending' : 'skipped', seconds: null }
    const next = started[started.indexOf(id) + 1]
    const seconds = Math.max(0, (next ? parsed.stageStarts[next]! : end) - start)
    const state = id === last ? lastStageState(record, interrupted) : 'done'
    return { id, label: STAGE_LABELS[id], state: state === 'done' && warned.has(id) ? 'warning' : state, seconds }
  })
}

export function stageTime(stage: StageView): string {
  if (stage.seconds !== null) return formatSeconds(stage.seconds)
  return stage.state === 'pending' ? '' : 'skipped'
}

function failureOutcome(record: DeployRecord, config: SiteConfig, stage: StageId | null, liveCommit: string): string {
  if (record.status === 'reverted') return 'Shellway switched back to the previous release automatically.'
  const beforeLive = stage === 'fetch' || (stage === 'build' && config.layout === 'releases')
  if (beforeLive) return liveCommit ? `The live site was not touched and still serves ${shortSha(liveCommit)}.` : 'Nothing was made live.'
  if (stage === 'build') return 'The site folder already has the new code, so the site may be partly updated.'
  return record.note ? `${record.note.charAt(0).toUpperCase()}${record.note.slice(1)}.` : ''
}

export function failureView(parsed: ParsedLog, record: DeployRecord, config: SiteConfig, liveCommit: string, interrupted: boolean): FailureView | null {
  if (record.status !== 'failed' && record.status !== 'reverted' && !interrupted) return null
  const step = failedStep(parsed)
  const stage = step?.stage ?? lastStartedStage(parsed)
  return {
    command: step?.command ?? '',
    exitCode: step?.exitCode ?? null,
    stageLabel: stage ? STAGE_LABELS[stage] : '',
    outcome: interrupted ? 'The deploy stopped before it finished, for example because the server restarted.' : failureOutcome(record, config, stage, liveCommit),
    sectionKey: step?.key ?? null
  }
}

function lastStartedStage(parsed: ParsedLog): StageId | null {
  const started = STAGE_IDS.filter((id) => parsed.stageStarts[id] !== undefined)
  return started[started.length - 1] ?? null
}

export interface SkippedRow {
  title: string
}

export function skippedRows(parsed: ParsedLog, record: DeployRecord, config: SiteConfig): SkippedRow[] {
  if (!parsed.structured || (record.status !== 'failed' && record.status !== 'cancelled')) return []
  const { stageStarts } = parsed
  const ranInBuild = parsed.sections.filter((s) => s.kind === 'step' && s.stage === 'build').length
  const rows: SkippedRow[] = []
  if (stageStarts.golive === undefined && stageStarts.after === undefined) {
    rows.push(...config.buildSteps.slice(ranInBuild).map((s) => ({ title: s.command })))
  }
  const after = config.activateSteps.length
  if (stageStarts.after === undefined && after > 0) rows.push({ title: `After going live · ${after} command${after === 1 ? '' : 's'}` })
  return rows
}
