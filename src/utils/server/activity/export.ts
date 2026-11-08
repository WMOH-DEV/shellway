import type { ActivityEntry, ActivityStep } from '@/types/server/core'
import { formatDuration, STATUS_LABEL, WHO_LABEL } from './format'

export type ActivityExportFormat = 'json' | 'txt'

export function activityToJson(entries: ActivityEntry[]): string {
  return JSON.stringify(entries, null, 2)
}

export function activityToText(entries: ActivityEntry[]): string {
  return entries.map(entryText).join('\n\n')
}

export function exportFileName(sessionName: string, format: ActivityExportFormat, now: number): string {
  const safeName = sessionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '') || 'server'
  return `${safeName}-activity-${new Date(now).toISOString().slice(0, 10)}.${format}`
}

function entryText(entry: ActivityEntry): string {
  const duration = formatDuration(entry.durationMs)
  const header = [
    new Date(entry.at).toISOString(),
    STATUS_LABEL[entry.status],
    entry.area,
    WHO_LABEL[entry.who],
    ...(duration ? [duration] : [])
  ].join(' | ')
  const lines = [`${header}\n${entry.title}`]
  if (entry.failure) lines.push(`Failed: ${entry.failure.message}`)
  lines.push(...entry.steps.map(stepText))
  return lines.join('\n')
}

function stepText(step: ActivityStep): string {
  const exit = step.exitCode === null ? '' : ` (exit ${step.exitCode})`
  const output = step.output.trimEnd()
  return [`  [${step.status}] ${step.label}${exit}`, `  $ ${step.display.split('\n').join('\n    ')}`, ...(output ? [indent(output)] : [])].join('\n')
}

function indent(text: string): string {
  return text.split('\n').map((line) => `    ${line}`).join('\n')
}
