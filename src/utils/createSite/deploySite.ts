import type { CreateSiteInput, SiteServer } from '../../types/createSite'
import type { DeployStep, SiteConfig } from '../../types/deploy'
import { applyPreset, newSite } from '../deploy/presets'
import { pinPhpVersion } from './php'
import { pm2ActivateSteps } from './pm2'
import { TEMPLATES, usesPhp, type SiteTemplate } from './templates'
import { assertDomain, assertFolder, assertHealthPath, assertSiteName } from './validate'

const COMPOSE = /^docker compose /

const pinComposeProject = (siteName: string) => (step: DeployStep): DeployStep =>
  ({ ...step, command: step.command.replace(COMPOSE, `docker compose -p ${siteName} `) })

const pinPhp = (version: string) => (step: DeployStep): DeployStep => ({ ...step, command: pinPhpVersion(step.command, version) })

const hasVersionedPhp = (server: SiteServer): boolean => !(server.kind === 'apache' && server.layout === 'rhel')

function stepPin(input: CreateSiteInput, template: SiteTemplate, name: string): (step: DeployStep) => DeployStep {
  if (template.id === 'compose') return pinComposeProject(name)
  if (usesPhp(template) && hasVersionedPhp(input.server)) return pinPhp(input.phpVersion)
  return (step) => step
}

export function deploySiteConfig(input: CreateSiteInput): SiteConfig {
  const template = TEMPLATES[input.template]
  const name = assertSiteName(input.siteName)
  const preset = applyPreset(newSite(assertFolder(input.folder)), template.preset, { buildScript: false })
  const pin = stepPin(input, template, name)
  return {
    ...preset,
    name,
    repoUrl: input.repoUrl,
    branch: input.branch,
    sourceMode: input.sourceMode,
    pollMinutes: input.pollMinutes,
    layout: 'releases',
    healthUrl: `https://${assertDomain(input.domain)}${assertHealthPath(input.healthPath)}`,
    buildSteps: preset.buildSteps.map(pin),
    activateSteps: [...preset.activateSteps.map(pin), ...(template.id === 'node' ? pm2ActivateSteps(name, input.folder, input.appPort) : [])]
  }
}
