import type { CreateSiteInput } from '../../types/createSite'
import type { DeployStep, SiteConfig } from '../../types/deploy'
import { applyPreset, newSite } from '../deploy/presets'
import { TEMPLATES } from './templates'
import { assertDomain, assertFolder, assertHealthPath, assertSiteName } from './validate'

const COMPOSE = /^docker compose /

const pinComposeProject = (siteName: string) => (step: DeployStep): DeployStep =>
  ({ ...step, command: step.command.replace(COMPOSE, `docker compose -p ${siteName} `) })

export function deploySiteConfig(input: CreateSiteInput): SiteConfig {
  const template = TEMPLATES[input.template]
  const name = assertSiteName(input.siteName)
  const preset = applyPreset(newSite(assertFolder(input.folder)), template.preset, { buildScript: false })
  const pin = template.id === 'compose' ? pinComposeProject(name) : (step: DeployStep) => step
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
    activateSteps: preset.activateSteps.map(pin)
  }
}
