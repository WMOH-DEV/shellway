import type { DeployLayout, DeployStep, SiteConfig } from '@/types/deploy'

export interface QuietWindow {
  from: string
  to: string
}

export const POLL_CHOICES = [1, 2, 5, 10, 15, 30, 60]
export const DEFAULT_QUIET_WINDOW: QuietWindow = { from: '22:00', to: '06:00' }

const QUIET_HOURS = /^(\d\d:\d\d)-(\d\d:\d\d)$/
const NOTIFY_URL = /^https?:\/\/\S+$/

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

export const sameConfig = (a: SiteConfig, b: SiteConfig): boolean => same(a, b)

function changedSteps(saved: DeployStep[], draft: DeployStep[]): number {
  const length = Math.max(saved.length, draft.length)
  return Array.from({ length }, (_, i) => i).filter((i) => !same(saved[i], draft[i])).length
}

export function countChanges(saved: SiteConfig, draft: SiteConfig): number {
  const fields = (Object.keys(draft) as (keyof SiteConfig)[]).filter(
    (key) => key !== 'buildSteps' && key !== 'activateSteps' && !same(saved[key], draft[key])
  )
  return fields.length + changedSteps(saved.buildSteps, draft.buildSteps) + changedSteps(saved.activateSteps, draft.activateSteps)
}

export const changesLabel = (count: number): string =>
  count === 0 ? 'No unsaved changes' : `${count} unsaved ${count === 1 ? 'change' : 'changes'}`

export function parseQuietHours(value: string): QuietWindow | null {
  const match = QUIET_HOURS.exec(value)
  return match ? { from: match[1], to: match[2] } : null
}

export const joinQuietHours = ({ from, to }: QuietWindow): string => `${from}-${to}`

export function draftIssue(draft: SiteConfig): string | null {
  if ([...draft.buildSteps, ...draft.activateSteps].some((step) => !step.command.trim())) return 'A command is empty'
  if (draft.quietHours) {
    const window = parseQuietHours(draft.quietHours)
    if (!window) return 'Quiet hours need a start and an end time'
    if (window.from === window.to) return 'Quiet hours start and end must differ'
  }
  if (draft.notifyUrl && !NOTIFY_URL.test(draft.notifyUrl)) return 'Notification URL must start with http:// or https://'
  return null
}

export const pollChoices = (current: number): number[] =>
  POLL_CHOICES.includes(current) ? POLL_CHOICES : [...POLL_CHOICES, current].sort((a, b) => a - b)

export const releaseSwitchCommand = (layout: DeployLayout): string =>
  layout === 'releases' ? 'ln -sfn releases/<new> current' : 'git reset --hard <new>'

export type NotifyTarget = 'Slack' | 'Discord' | 'Webhook'

export function notifyTarget(url: string): NotifyTarget | null {
  if (!NOTIFY_URL.test(url)) return null
  const host = url.split('/')[2]
  if (host === 'hooks.slack.com') return 'Slack'
  return host === 'discord.com' || host === 'discordapp.com' ? 'Discord' : 'Webhook'
}

export const buildDescription = (layout: DeployLayout): string =>
  layout === 'releases'
    ? 'Runs in the new release before it goes live. A required failure stops here and the live site is untouched.'
    : 'Runs in the site folder right after the code updates. A required failure stops the deploy.'
