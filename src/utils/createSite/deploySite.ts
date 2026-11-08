import type { CreateSiteInput, SiteServer } from '../../types/createSite'
import type { DeployStep, SiteConfig } from '../../types/deploy'
import { applyPreset, newSite, presetById } from '../deploy/presets'
import { pinPhpVersion } from './php'
import { pm2ActivateSteps } from './pm2'
import { TEMPLATES, usesPhp, type SiteTemplate } from './templates'
import { assertDomain, assertFolder, assertHealthPath, assertSiteName } from './validate'

const COMPOSE = /^docker compose /

const pinComposeProject = (siteName: string) => (step: DeployStep): DeployStep =>
  ({ ...step, command: step.command.replace(COMPOSE, `docker compose -p ${siteName} `) })

const pinPhp = (version: string) => (step: DeployStep): DeployStep => ({ ...step, command: pinPhpVersion(step.command, version) })

const hasVersionedPhp = (server: SiteServer): boolean => !(server.kind === 'apache' && server.layout === 'rhel')

function stepPin(input: Pick<CreateSiteInput, 'server' | 'phpVersion'>, template: SiteTemplate, name: string): (step: DeployStep) => DeployStep {
  if (template.id === 'compose') return pinComposeProject(name)
  if (usesPhp(template) && hasVersionedPhp(input.server)) return pinPhp(input.phpVersion)
  return (step) => step
}

export type CommandFacts = Pick<CreateSiteInput, 'template' | 'siteName' | 'folder' | 'appPort' | 'phpVersion' | 'server' | 'buildOutput'>

const NPM_BUILD: DeployStep[] = [
  { command: 'npm ci', optional: false, timeoutSeconds: null },
  { command: 'npm run build', optional: false, timeoutSeconds: null }
]

const buildsWithNpm = ({ template, buildOutput }: Pick<CommandFacts, 'template' | 'buildOutput'>): boolean => template === 'static' && buildOutput !== null

export interface DeployCommands {
  buildSteps: DeployStep[]
  activateSteps: DeployStep[]
}

export interface RepoHints {
  buildScript: boolean
}

function presetBuildSteps(template: SiteTemplate, hints: RepoHints): DeployStep[] {
  const steps = presetById(template.preset).buildSteps(hints)
  return usesPhp(template) && hints.buildScript ? [...steps, ...NPM_BUILD] : steps
}

export function defaultCommands(facts: CommandFacts, hints: RepoHints = { buildScript: false }): DeployCommands {
  const template = TEMPLATES[facts.template]
  const name = assertSiteName(facts.siteName)
  const pin = stepPin(facts, template, name)
  return {
    buildSteps: buildsWithNpm(facts) ? NPM_BUILD.map((step) => ({ ...step })) : presetBuildSteps(template, hints).map(pin),
    activateSteps: [...presetById(template.preset).activateSteps.map(pin), ...(template.id === 'node' ? pm2ActivateSteps(name, facts.folder, facts.appPort) : [])]
  }
}

export function deploySiteConfig(input: CreateSiteInput): SiteConfig {
  const template = TEMPLATES[input.template]
  const preset = applyPreset(newSite(assertFolder(input.folder)), template.preset, { buildScript: false })
  return {
    ...preset,
    name: assertSiteName(input.siteName),
    repoUrl: input.repoUrl,
    branch: input.branch,
    sourceMode: input.sourceMode,
    pollMinutes: input.pollMinutes,
    layout: 'releases',
    healthUrl: `https://${assertDomain(input.domain)}${assertHealthPath(input.healthPath)}`,
    buildSteps: input.buildSteps.map((step) => ({ ...step })),
    activateSteps: input.activateSteps.map((step) => ({ ...step }))
  }
}
