import type { ActionPlan, ActionStep, PlanBlock, ServerFacts } from '@/types/server/core'
import { IDENTITY_PROBE, type OsInfo, type ServerIdentity } from '@/types/server/identity'
import { APT_GET } from '../apt'
import { installRecipe, installSupport, type ComponentId } from '../install'
import { aptUpdate, rootStep } from '../install/steps'
import { PROFILES } from './catalog'
import { planComponents, type PlannedComponent } from './components'
import { FILES_PROBE, INVENTORY_PROBE } from './inventory'
import { withOsFamily } from './overrides'
import { securityPart } from './security'
import type { GroupId, SetupFiles, SetupInventory, SetupParams } from './types'

export const GROUP_LABELS: Record<GroupId, string> = {
  update: 'System update',
  web: 'Web server',
  languages: 'Languages',
  databases: 'Databases',
  tools: 'Tools',
  security: 'Security'
}

const MINUTES: Record<ComponentId, number> = {
  nginx: 0.5,
  apache: 0.5,
  php: 1.5,
  composer: 0.5,
  mysql: 1.5,
  mariadb: 1.5,
  postgresql: 1.5,
  redis: 0.5,
  node: 1,
  pm2: 0.5,
  supervisor: 0.5,
  certbot: 1,
  docker: 1.5,
  ufw: 0.25,
  fail2ban: 0.5,
  'unattended-upgrades': 0.25
}

const SYSTEM_UPDATE_MINUTES = 2

const SECURITY_CHANGE_MINUTES = 0.25

const DOCKER_FIREWALL_WARNING = 'Docker publishes container ports past the ufw firewall. Bind container ports to 127.0.0.1 unless they must be public.'

interface SetupFacts {
  os: OsInfo
  inventory: SetupInventory
  files: SetupFiles
}

export interface SetupSummary {
  installCount: number
  securityCount: number
  minutes: number
}

function factData<T>(facts: ServerFacts, id: string): T | string {
  const result = facts[id]
  if (!result) return 'it was not checked'
  if (result.status === 'ok') return result.data as T
  return result.status === 'unavailable' ? result.reason : result.error
}

function readFacts(params: SetupParams, facts: ServerFacts): SetupFacts | PlanBlock {
  const identity = factData<ServerIdentity>(facts, IDENTITY_PROBE)
  if (typeof identity === 'string') return { kind: 'precondition', message: `Could not read the operating system: ${identity}` }
  const inventory = factData<SetupInventory>(facts, INVENTORY_PROBE)
  if (typeof inventory === 'string') return { kind: 'precondition', message: `Could not check what is installed: ${inventory}` }
  const files = factData<SetupFiles>(facts, FILES_PROBE)
  if (typeof files === 'string') return { kind: 'sudo', message: `Setting up this server needs root or passwordless sudo: ${files}` }
  return { os: withOsFamily(identity.os, params.osFamily), inventory, files }
}

const grouped = (group: GroupId) => (step: ActionStep): ActionStep => ({
  ...step,
  id: `${group}.${step.id}`,
  group: GROUP_LABELS[group]
})

function systemUpdateStep(): ActionStep {
  return rootStep('upgrade', 'Update the package lists and installed packages', [...aptUpdate(), `${APT_GET} upgrade --with-new-pkgs`])
}

function componentSteps(planned: PlannedComponent[], os: OsInfo): { steps: ActionStep[]; problems: string[] } {
  const steps: ActionStep[] = []
  const problems: string[] = []
  for (const item of planned) {
    const recipe = installRecipe(item.request, os)
    if (recipe.supported) steps.push(...recipe.steps.map(grouped(item.group)))
    else problems.push(recipe.reason)
  }
  return { steps, problems }
}

const profileTitle = (params: SetupParams): string => PROFILES.find((profile) => profile.id === params.profile)?.title ?? 'Custom'

const securityCount = (params: SetupParams): number => Object.values(params.security).filter(Boolean).length

export function setupSummary(params: SetupParams, inventory: SetupInventory): SetupSummary {
  const components = planComponents(params.rows, inventory).install
  const changes = securityCount(params)
  const minutes = SYSTEM_UPDATE_MINUTES + changes * SECURITY_CHANGE_MINUTES + components.reduce((total, item) => total + MINUTES[item.request.component], 0)
  return { installCount: components.length, securityCount: changes, minutes: Math.ceil(minutes) }
}

function warningsFor(params: SetupParams, alreadyInstalled: string[], notes: string[]): string[] {
  return [
    ...(alreadyInstalled.length > 0 ? [`Already installed, so skipped: ${alreadyInstalled.join(', ')}.`] : []),
    ...notes,
    ...(params.rows.docker.on && params.security.firewall ? [DOCKER_FIREWALL_WARNING] : [])
  ]
}

const pluralize = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

export function buildSetupPlan(params: SetupParams, facts: ServerFacts): ActionPlan {
  const base: ActionPlan = { title: `Set up this server (${profileTitle(params)})`, area: 'setup', summary: '', steps: [], warnings: [], blocked: null, secrets: [] }
  const read = readFacts(params, facts)
  if ('kind' in read) return { ...base, blocked: read }
  const unsupportedReason = installSupport(read.os)
  if (unsupportedReason) return { ...base, blocked: { kind: 'unsupported', message: unsupportedReason } }

  const components = planComponents(params.rows, read.inventory)
  const installs = componentSteps(components.install, read.os)
  const security = securityPart({ ...read, params })
  const problems = [...components.problems, ...installs.problems, ...security.problems]
  const steps = [grouped('update')(systemUpdateStep()), ...installs.steps, ...security.steps.map(grouped('security'))]
  return {
    ...base,
    summary: `Install ${pluralize(components.install.length, 'component')} and apply ${pluralize(securityCount(params), 'security change')} on ${read.os.prettyName}.`,
    steps,
    warnings: warningsFor(params, components.alreadyInstalled, [...components.notes, ...security.notes]),
    blocked: problems.length > 0 ? { kind: 'precondition', message: problems.join(' ') } : null
  }
}
