import type { SiteConfig } from '@/types/deploy'
import { isHttpUrl, parseGitHubRepo } from './githubRepo'

export const SETUP_STEPS = ['where', 'code', 'layout', 'commands', 'ready'] as const
export type SetupStep = (typeof SETUP_STEPS)[number]

export type PlanPart = string | { code: string }
export type PlanLine = PlanPart[]

export interface FirstDeployPlan {
  lines: PlanLine[]
  footer: PlanLine | null
}

export interface StepContext {
  existingNames: string[]
  nameLocked: boolean
}

export const STEP_TITLES: Record<SetupStep, string> = {
  where: 'Where',
  code: 'Code',
  layout: 'Folder layout',
  commands: 'Commands',
  ready: 'Ready check'
}

const SITE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/
const BRANCH_NAME = /^[A-Za-z0-9._/-]+$/

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

const inRange = (value: number, min: number, max: number): boolean => Number.isInteger(value) && value >= min && value <= max

export function repoLabel(site: SiteConfig): string {
  const github = parseGitHubRepo(site.repoUrl)
  return github ? `${github.owner}/${github.repo}` : site.repoUrl
}

function whereError(site: SiteConfig, { existingNames, nameLocked }: StepContext): string | null {
  if (!site.path.startsWith('/') || site.path.replace(/\/+$/, '') === '') return 'Enter the absolute folder the web server serves'
  if (!SITE_NAME.test(site.name)) return 'Name must be lowercase letters, numbers and dashes (max 40)'
  if (!nameLocked && existingNames.includes(site.name)) return 'A site with this name already exists on this server'
  return null
}

function codeError(site: SiteConfig): string | null {
  if (!site.repoUrl || /\s/.test(site.repoUrl)) return 'Enter the repository URL'
  if (!BRANCH_NAME.test(site.branch) || site.branch.includes('..') || site.branch.startsWith('-')) return 'Branch name is not valid'
  if (site.sourceMode === 'auto' && !inRange(site.pollMinutes, 1, 60)) return 'Check interval must be between 1 and 60 minutes'
  return null
}

function layoutError(site: SiteConfig): string | null {
  if (!site.envFile) return 'Enter the env file name'
  if (site.layout === 'releases' && !inRange(site.keepReleases, 1, 50)) return 'Releases to keep must be between 1 and 50'
  return null
}

function commandsError(site: SiteConfig): string | null {
  if ([...site.buildSteps, ...site.activateSteps].some((step) => !step.command.trim())) return 'Fill in or remove the empty commands'
  if (site.healthUrl && !isHttpUrl(site.healthUrl)) return 'Health check URL must start with http:// or https://'
  if (!inRange(site.healthStatus, 100, 599)) return 'Expected status must be between 100 and 599'
  return null
}

export function stepError(step: SetupStep, site: SiteConfig, context: StepContext): string | null {
  if (step === 'where') return whereError(site, context)
  if (step === 'code') return codeError(site)
  if (step === 'layout') return layoutError(site)
  if (step === 'commands') return commandsError(site)
  return null
}

export function needsSave(saved: SiteConfig | null, site: SiteConfig): boolean {
  return saved === null || JSON.stringify(saved) !== JSON.stringify(site)
}

function readyDetail(requiredLeft: number | null): string {
  if (requiredLeft === null) return 'Not checked yet'
  return requiredLeft === 0 ? 'Ready to deploy' : `${plural(requiredLeft, 'item')} to fix`
}

export function stepDetail(step: SetupStep, site: SiteConfig, presetLabel: string, requiredLeft: number | null): string {
  if (step === 'where') return `${site.path || 'No folder yet'} · ${presetLabel}`
  if (step === 'code') return `${repoLabel(site) || 'No repository yet'} · ${site.branch} · ${site.sourceMode === 'auto' ? 'Auto' : 'From my PC'}`
  if (step === 'layout') return site.layout === 'releases' ? `Releases · keep ${site.keepReleases}` : 'In place'
  if (step === 'commands') {
    const count = site.buildSteps.length + site.activateSteps.length
    return count === 0 ? 'No commands' : plural(count, 'command')
  }
  return readyDetail(requiredLeft)
}

function sourceLine(site: SiteConfig): PlanLine {
  const repo = { code: repoLabel(site) || 'the repository' }
  const branch = { code: site.branch }
  return site.sourceMode === 'auto' ? ['Clone ', repo, ' at ', branch] : ['Send ', branch, ' of ', repo, ' from this PC']
}

function buildLines(site: SiteConfig): PlanLine[] {
  const count = site.buildSteps.length
  const commands = count === 0 ? [] : [` · ${plural(count, 'command')}`]
  if (site.layout === 'inplace') return count === 0 ? [] : [[`Run ${plural(count, 'build command')} in `, { code: site.path }]]
  return [['Build in ', { code: 'releases/<new>' }, ...commands], ['Point ', { code: 'current' }, ' at it']]
}

function afterLiveLines(site: SiteConfig): PlanLine[] {
  const count = site.activateSteps.length
  return count === 0 ? [] : [[`Run ${plural(count, 'after-live command')}`]]
}

function healthLines(site: SiteConfig): PlanLine[] {
  return site.healthUrl ? [['Check ', { code: site.healthUrl }, ` returns ${site.healthStatus}`]] : []
}

function planFooter(site: SiteConfig): PlanLine | null {
  if (site.sourceMode === 'auto') return ['Then checks ', { code: site.branch }, ` every ${plural(site.pollMinutes, 'min')} and deploys new commits by itself.`]
  return site.pcAuto ? ['Then deploys new commits while Shellway is open and connected.'] : null
}

export function firstDeployPlan(site: SiteConfig): FirstDeployPlan {
  return {
    lines: [sourceLine(site), ...buildLines(site), ...afterLiveLines(site), ...healthLines(site)],
    footer: planFooter(site)
  }
}
