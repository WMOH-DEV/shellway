import type { CloudflareZoneRef, CreateSiteContext, CreateSiteInput, CreateSiteSecrets, DnsInput, LaravelJobs, NameCheck, PlanActionId, ServerTools, SiteServer, TemplateId } from '@/types/createSite'
import type { DeployStep, SourceMode } from '@/types/deploy'
import { newSite, siteNameFromPath } from '../deploy/presets'
import { defaultCommands, type DeployCommands } from './deploySite'
import { generatePassword } from '../server/databases/password'
import { databaseChoices, defaultDatabase, siteDatabase, type DatabaseChoice } from './database'
import { generateAppKey, writesEnv } from './env'
import { ALL_JOBS, NO_JOBS, availableJobs } from './laravelJobs'
import { phpVersionFor, type StackSuggestion } from './repoSuggest'
import { isValidEmail } from '../ssl/https/issueCommands'
import { webServerDriver, type WebServerDriver } from '../webServer'
import { templateAvailability } from './availability'
import { phpNeed } from './php'
import { assertPoolOwner } from './phpPool'
import { TEMPLATES, usesPhp } from './templates'
import { assertBuildOutput, assertDomain, assertFolder, assertPort, assertSiteName } from './validate'

export const WIZARD_STEPS = ['site', 'stack', 'commands', 'domain', 'review'] as const

export type WizardStep = (typeof WIZARD_STEPS)[number]

export const STEP_TITLES: Record<WizardStep | 'create', string> = {
  site: 'Site and code',
  stack: 'Stack',
  commands: 'Commands and environment',
  domain: 'DNS and HTTPS',
  review: 'Review the plan',
  create: 'Create'
}

export type ServerContext = CreateSiteContext & { server: SiteServer }

export interface CreateSiteDraft {
  domain: string
  includeWww: boolean
  siteName: string
  folder: string
  template: TemplateId
  phpVersion: string
  appPort: number
  repoUrl: string
  branch: string
  sourceMode: SourceMode
  pollMinutes: number
  proxied: boolean
  email: string
  redirect: boolean
  staging: boolean
  commands: DeployCommands | null
  database: DatabaseChoice
  envText: string
  dbPassword: string
  appKey: string
  jobs: LaravelJobs
  staticBuild: boolean
  outputDir: string
  spa: boolean
  repoBuildScript: boolean
}

export interface NameCheckState {
  domain: string
  result: NameCheck | null
  error: string | null
}

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[]

const DEFAULT_APP_PORT = 3000
const DEFAULT_OUTPUT_DIR = 'dist'
const MAX_POLL_MINUTES = 60

const ACTION_STEPS: Record<PlanActionId, WizardStep> = {
  php: 'stack',
  composer: 'stack',
  pm2: 'stack',
  folder: 'site',
  pool: 'stack',
  modules: 'stack',
  site: 'stack',
  database: 'commands',
  dns: 'domain',
  https: 'domain',
  deploys: 'commands',
  env: 'commands',
  'first-deploy': 'commands',
  jobs: 'commands'
}

export const hasServer = (context: CreateSiteContext): context is ServerContext => context.server !== null

export const driverFor = (server: SiteServer): WebServerDriver => webServerDriver(server.kind, server.kind === 'apache' ? server.layout : null)

export const stepForAction = (id: PlanActionId): WizardStep => ACTION_STEPS[id]

export const siteNameFromDomain = (domain: string): string => siteNameFromPath(domain.split('.')[0] ?? '')

export const folderForName = (siteName: string): string => `/var/www/${siteName}`

function firstUsableTemplate(tools: ServerTools): TemplateId {
  return TEMPLATE_IDS.find((id) => templateAvailability(id, tools).state !== 'blocked') ?? 'blank'
}

export function newDraft(tools: ServerTools): CreateSiteDraft {
  const { branch, sourceMode, pollMinutes } = newSite()
  const template = firstUsableTemplate(tools)
  return {
    domain: '',
    includeWww: true,
    siteName: '',
    folder: '',
    template,
    phpVersion: tools.php.installed[0] ?? tools.php.installable[0] ?? '',
    appPort: DEFAULT_APP_PORT,
    repoUrl: '',
    branch,
    sourceMode,
    pollMinutes,
    proxied: true,
    email: '',
    redirect: true,
    staging: true,
    commands: null,
    database: defaultDatabase(template, tools),
    envText: '',
    dbPassword: generatePassword(),
    appKey: generateAppKey(),
    jobs: availableJobs(tools, ALL_JOBS),
    staticBuild: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    spa: false,
    repoBuildScript: false
  }
}

const fails = (check: () => unknown): boolean => {
  try {
    check()
    return false
  } catch {
    return true
  }
}

export function nameCheckProblem(check: NameCheckState | null, domain: string): string | null {
  if (check === null || check.domain !== domain) return `Checking ${domain}…`
  if (check.error !== null) return check.error
  if (check.result === null) return `Checking ${domain}…`
  if (check.result.records.length > 0) return `${domain} already has DNS records. Pick a name that is not in use yet.`
  if (check.result.servedBy !== null) return `${domain} is already served by ${check.result.servedBy}.`
  return null
}

function staticBuildProblem(draft: CreateSiteDraft, tools: ServerTools): string | null {
  const output = buildOutputOf(draft)
  if (output === null) return null
  if (fails(() => assertBuildOutput(output))) return 'Enter the folder the build writes to, such as dist'
  return tools.node === null ? 'Node.js is not installed on this server, so the site cannot be built there. Install it, or serve the files as they are.' : null
}

function templateProblem(draft: CreateSiteDraft, tools: ServerTools): string | null {
  const template = TEMPLATES[draft.template]
  const availability = templateAvailability(draft.template, tools)
  if (availability.state === 'blocked') return `${template.label} cannot be used here: ${availability.reason}`
  const buildProblem = staticBuildProblem(draft, tools)
  if (buildProblem !== null) return buildProblem
  if (usesPhp(template) && phpNeed(tools.php, draft.phpVersion).kind === 'unavailable') return 'Pick a PHP version'
  if (template.proxiesToApp && fails(() => assertPort(draft.appPort))) return 'Enter an app port from 1 to 65535'
  return null
}

function codeProblem(draft: CreateSiteDraft): string | null {
  if (draft.repoUrl === '') return 'Enter the repository'
  if (draft.branch === '') return 'Enter the branch'
  const { pollMinutes } = draft
  if (draft.sourceMode === 'auto' && (!Number.isInteger(pollMinutes) || pollMinutes < 1 || pollMinutes > MAX_POLL_MINUTES)) {
    return `Check for new commits every 1 to ${MAX_POLL_MINUTES} minutes`
  }
  return null
}

export function siteStepProblem(draft: CreateSiteDraft, check: NameCheckState | null, context: CreateSiteContext): string | null {
  if (fails(() => assertDomain(draft.domain))) return 'Enter a domain such as shop.example.com'
  const nameProblem = nameCheckProblem(check, draft.domain)
  if (nameProblem !== null) return nameProblem
  if (fails(() => assertSiteName(draft.siteName))) return 'Site name: lowercase letters, digits, dots and dashes'
  if (context.deploySiteNames.includes(draft.siteName)) return `There is already a site named ${draft.siteName}`
  if (fails(() => assertFolder(draft.folder))) return 'Enter the folder as a full path, such as /var/www/shop'
  return codeProblem(draft)
}

export function stackStepProblem(draft: CreateSiteDraft, context: Pick<CreateSiteContext, 'tools' | 'owner'>): string | null {
  if (usesPhp(TEMPLATES[draft.template]) && fails(() => assertPoolOwner(context.owner))) {
    return `You are logged in as root, and PHP-FPM will not run a site as root. Log in as a regular user (Setup can create one), then open Create site again.`
  }
  return templateProblem(draft, context.tools)
}

export function commandsStepProblem(draft: CreateSiteDraft, tools: ServerTools): string | null {
  if (draft.database !== 'none' && !databaseChoices(draft.template, tools).includes(draft.database)) return 'Pick a database this server has'
  return null
}

export function domainStepProblem(draft: CreateSiteDraft): string | null {
  return isValidEmail(draft.email.trim()) ? null : "Enter an email for Let's Encrypt"
}

export function dnsInput(draft: CreateSiteDraft, context: CreateSiteContext, zone: CloudflareZoneRef | null): DnsInput | null {
  const { serverIp } = context
  if (serverIp === null) return null
  if (zone === null || !context.dnsEdit) return { zoneId: null, zoneName: null, serverIp, proxied: false }
  return { zoneId: zone.id, zoneName: zone.name, serverIp, proxied: draft.proxied }
}

const isStatic = (draft: Pick<CreateSiteDraft, 'template'>): boolean => draft.template === 'static'

export const buildOutputOf = (draft: Pick<CreateSiteDraft, 'template' | 'staticBuild' | 'outputDir'>): string | null =>
  isStatic(draft) && draft.staticBuild ? draft.outputDir.trim() : null

export const defaultCommandsOf = (draft: CreateSiteDraft, server: SiteServer): DeployCommands =>
  defaultCommands({ ...draft, server, buildOutput: buildOutputOf(draft) }, { buildScript: draft.repoBuildScript })

export function suggestedDraft(draft: CreateSiteDraft, suggestion: StackSuggestion, tools: ServerTools): Partial<CreateSiteDraft> {
  const template = suggestion.template ?? draft.template
  const phpVersion = phpVersionFor(tools.php, suggestion.phpMinimum)
  return {
    template,
    commands: null,
    database: template === draft.template ? draft.database : defaultDatabase(template, tools),
    repoBuildScript: suggestion.buildScript && tools.node !== null,
    ...(phpVersion !== null ? { phpVersion } : {}),
    ...(suggestion.outputDir !== null ? { staticBuild: true, outputDir: suggestion.outputDir } : {}),
    ...(draft.envText === '' && suggestion.envExample !== null ? { envText: suggestion.envExample } : {})
  }
}

export const commandsOf = (draft: CreateSiteDraft, server: SiteServer): DeployCommands => draft.commands ?? defaultCommandsOf(draft, server)

export function toSecrets(draft: CreateSiteDraft, input: CreateSiteInput): CreateSiteSecrets {
  return {
    dbPassword: input.database !== null && input.database.engine !== 'sqlite' ? draft.dbPassword : null,
    appKey: input.template === 'laravel' ? draft.appKey : null,
    envText: draft.envText
  }
}

const filledSteps = (steps: DeployStep[]): DeployStep[] =>
  steps.map((step) => ({ ...step, command: step.command.trim() })).filter((step) => step.command !== '')

export function toInput(draft: CreateSiteDraft, context: ServerContext, zone: CloudflareZoneRef | null): CreateSiteInput {
  const { proxied: _proxied, email, redirect, staging, commands: _commands, database: choice, envText, dbPassword: _password, appKey: _key, staticBuild: _build, outputDir: _output, repoBuildScript: _repoBuild, ...site } = draft
  const { buildSteps, activateSteps } = commandsOf(draft, context.server)
  const database = siteDatabase(choice, draft)
  return {
    ...site,
    database,
    jobs: draft.template === 'laravel' ? availableJobs(context.tools, draft.jobs) : NO_JOBS,
    buildOutput: buildOutputOf(draft),
    spa: isStatic(draft) && draft.spa,
    env: writesEnv({ ...draft, database }, envText),
    owner: context.owner,
    server: context.server,
    buildSteps: filledSteps(buildSteps),
    activateSteps: filledSteps(activateSteps),
    dns: dnsInput(draft, context, zone),
    https: { email: email.trim(), redirect, staging },
    healthPath: TEMPLATES[draft.template].healthPath
  }
}
