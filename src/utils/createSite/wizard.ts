import type { CloudflareZoneRef, CodeSource, CreateSiteContext, NewRepo, ProjectCheckRequest, CreateSiteInput, CreateSiteSecrets, DnsInput, LaravelJobs, NameCheck, PlanActionId, ServerTools, SiteServer, TemplateId } from '@/types/createSite'
import type { DeployStep, SourceMode } from '@/types/deploy'
import { newSite, siteNameFromPath } from '../deploy/presets'
import { defaultCommands, type DeployCommands } from './deploySite'
import { generatePassword } from '../server/databases/password'
import { databaseChoices, defaultDatabase, needsDatabase, siteDatabase, type DatabaseChoice } from './database'
import { generateAppKey, writesEnv } from './env'
import { ALL_JOBS, NO_JOBS, availableJobs } from './laravelJobs'
import { phpVersionFor, type StackSuggestion } from './repoSuggest'
import { NEW_PROJECT_TEMPLATES, NO_CODE_TEMPLATES, githubSshUrlOf } from './scaffold'
import { isValidEmail } from '../ssl/https/issueCommands'
import { webServerDriver, type WebServerDriver } from '../webServer'
import { templateAvailability } from './availability'
import { existingDnsOf } from './existingDns'
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
  commandsBasis: string
  database: DatabaseChoice
  envText: string
  suggestedEnvText: string
  dbPassword: string
  appKey: string
  jobs: LaravelJobs
  staticBuild: boolean
  outputDir: string
  spa: boolean
  repoBuildScript: boolean
  codeSource: CodeSource
  repoKind: NewRepo['kind']
  repoName: string
  repoPrivate: boolean
  githubOwner: string
  localParent: string
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
  repo: 'site',
  scaffold: 'stack',
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
    commandsBasis: '',
    database: defaultDatabase(template, tools),
    envText: '',
    suggestedEnvText: '',
    dbPassword: generatePassword(),
    appKey: generateAppKey(),
    jobs: availableJobs(tools, ALL_JOBS),
    staticBuild: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    spa: false,
    repoBuildScript: false,
    codeSource: 'git',
    repoKind: 'github',
    repoName: '',
    repoPrivate: true,
    githubOwner: '',
    localParent: ''
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

export function nameCheckProblem(check: NameCheckState | null, site: Pick<CreateSiteDraft, 'domain' | 'includeWww'>, serverIp: string | null): string | null {
  const { domain } = site
  if (check === null || check.domain !== domain) return `Checking ${domain}…`
  if (check.error !== null) return check.error
  if (check.result === null) return `Checking ${domain}…`
  if (existingDnsOf(check.result.records, site, serverIp).blocking.length > 0) return `${domain} already has DNS records that point somewhere else. Pick a name that is not in use yet.`
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

const GITHUB_REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/

export const repoNameOf = (draft: Pick<CreateSiteDraft, 'repoName' | 'siteName'>): string => draft.repoName.trim() || draft.siteName

function pollProblem({ sourceMode, pollMinutes }: CreateSiteDraft): string | null {
  if (sourceMode === 'auto' && (!Number.isInteger(pollMinutes) || pollMinutes < 1 || pollMinutes > MAX_POLL_MINUTES)) {
    return `Check for new commits every 1 to ${MAX_POLL_MINUTES} minutes`
  }
  return null
}

function gitProblem(draft: CreateSiteDraft): string | null {
  if (draft.repoUrl === '') return 'Enter the repository'
  if (draft.branch === '') return 'Enter the branch'
  return pollProblem(draft)
}

function newRepoProblem(draft: CreateSiteDraft): string | null {
  if (draft.repoKind === 'empty') return draft.repoUrl === '' ? 'Enter the URL of the empty repository' : null
  if (draft.githubOwner === '') return 'Connect GitHub to create the repository'
  const name = repoNameOf(draft)
  return GITHUB_REPO_NAME.test(name) && name !== '.' && name !== '..' ? null : 'Repository name: letters, digits, dots, dashes and underscores'
}

function newProjectProblem(draft: CreateSiteDraft, project: ProjectCheckState | null): string | null {
  const repoProblem = newRepoProblem(draft)
  if (repoProblem !== null) return repoProblem
  if (draft.branch === '') return 'Enter the branch'
  if (draft.localParent.trim() === '') return 'Choose where the project goes on this PC'
  const pollIssue = pollProblem(draft)
  if (pollIssue !== null) return pollIssue
  if (project === null || project.key !== projectCheckKey(draft)) return 'Checking the repository and the folder on this PC…'
  return project.problem
}

function codeProblem(draft: CreateSiteDraft, project: ProjectCheckState | null): string | null {
  switch (draft.codeSource) {
    case 'git': return gitProblem(draft)
    case 'new': return newProjectProblem(draft, project)
    case 'none': return null
  }
}

export interface ProjectCheckState {
  key: string
  problem: string | null
}

export function projectCheckRequest(draft: CreateSiteDraft): ProjectCheckRequest {
  const repo: NewRepo = draft.repoKind === 'github' ? { kind: 'github', owner: draft.githubOwner, name: repoNameOf(draft), private: draft.repoPrivate } : { kind: 'empty' }
  return { repo, repoUrl: repoUrlOf(draft), localParent: draft.localParent.trim(), siteName: draft.siteName }
}

export const projectCheckKey = (draft: CreateSiteDraft): string => JSON.stringify(projectCheckRequest(draft))

export function repoUrlOf(draft: CreateSiteDraft): string {
  if (draft.codeSource === 'none') return ''
  if (draft.codeSource === 'new' && draft.repoKind === 'github') return githubSshUrlOf(draft.githubOwner, repoNameOf(draft))
  return draft.repoUrl
}

export function allowedTemplates(source: CodeSource): readonly TemplateId[] {
  if (source === 'new') return NEW_PROJECT_TEMPLATES
  return source === 'none' ? NO_CODE_TEMPLATES : TEMPLATE_IDS
}

export function siteStepProblem(draft: CreateSiteDraft, check: NameCheckState | null, context: CreateSiteContext, project: ProjectCheckState | null = null): string | null {
  if (fails(() => assertDomain(draft.domain))) return 'Enter a domain such as shop.example.com'
  const nameProblem = nameCheckProblem(check, draft, context.serverIp)
  if (nameProblem !== null) return nameProblem
  if (fails(() => assertSiteName(draft.siteName))) return 'Site name: lowercase letters, digits, dots and dashes'
  if (context.deploySiteNames.includes(draft.siteName)) return `There is already a site named ${draft.siteName}`
  if (fails(() => assertFolder(draft.folder))) return 'Enter the folder as a full path, such as /var/www/shop'
  return codeProblem(draft, project)
}

export function stackStepProblem(draft: CreateSiteDraft, context: Pick<CreateSiteContext, 'tools' | 'owner'>): string | null {
  if (!allowedTemplates(draft.codeSource).includes(draft.template)) {
    return draft.codeSource === 'new' ? `${TEMPLATES[draft.template].label} cannot start as a new project. Use your own repository for it.` : 'Pick Static site or PHP for a site without code'
  }
  if (usesPhp(TEMPLATES[draft.template]) && fails(() => assertPoolOwner(context.owner))) {
    return `You are logged in as root, and PHP-FPM will not run a site as root. Log in as a regular user (Setup can create one), then open Create site again.`
  }
  return templateProblem(draft, context.tools)
}

export function commandsStepProblem(draft: CreateSiteDraft, tools: ServerTools, server: SiteServer): string | null {
  if (draft.codeSource === 'none') return null
  if (staleCommands(draft, server)) return 'Earlier settings changed after you edited the commands. Use the new defaults or keep yours.'
  if (draft.database === 'none' && needsDatabase(draft.template)) return 'Laravel runs its migrations on every deploy, so pick a database. SQLite needs no server.'
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

export const buildOutputOf = (draft: Pick<CreateSiteDraft, 'template' | 'staticBuild' | 'outputDir' | 'codeSource'>): string | null =>
  isStatic(draft) && draft.staticBuild && draft.codeSource === 'git' ? draft.outputDir.trim() : null

export const defaultCommandsOf = (draft: CreateSiteDraft, server: SiteServer): DeployCommands =>
  defaultCommands({ ...draft, server, buildOutput: buildOutputOf(draft) }, { buildScript: draft.codeSource === 'git' && draft.repoBuildScript })

export const commandsKey = (draft: CreateSiteDraft, server: SiteServer): string => JSON.stringify(defaultCommandsOf(draft, server))

export function staleCommands(draft: CreateSiteDraft, server: SiteServer): boolean {
  if (draft.commands === null) return false
  const key = commandsKey(draft, server)
  return draft.commandsBasis !== key && JSON.stringify(draft.commands) !== key
}

function suggestedEnv(draft: CreateSiteDraft, envExample: string | null): Partial<CreateSiteDraft> {
  if (draft.envText !== '' && draft.envText !== draft.suggestedEnvText) return {}
  return { envText: envExample ?? '', suggestedEnvText: envExample ?? '' }
}

function suggestedStatic(template: TemplateId, outputDir: string | null): Partial<CreateSiteDraft> {
  if (template !== 'static') return {}
  return outputDir === null ? { staticBuild: false } : { staticBuild: true, outputDir }
}

export function suggestedDraft(draft: CreateSiteDraft, suggestion: StackSuggestion, tools: ServerTools): Partial<CreateSiteDraft> {
  const template = suggestion.template ?? draft.template
  const phpVersion = phpVersionFor(tools.php, suggestion.phpMinimum)
  return {
    template,
    commands: null,
    database: template === draft.template ? draft.database : defaultDatabase(template, tools),
    repoBuildScript: suggestion.buildScript && tools.node !== null,
    ...(phpVersion !== null ? { phpVersion } : {}),
    ...suggestedStatic(template, suggestion.outputDir),
    ...suggestedEnv(draft, suggestion.envExample)
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
  const hasCode = draft.codeSource !== 'none'
  const { buildSteps, activateSteps } = commandsOf(draft, context.server)
  const database = hasCode ? siteDatabase(draft.database, draft) : null
  const isNew = draft.codeSource === 'new'
  return {
    domain: draft.domain,
    includeWww: draft.includeWww,
    siteName: draft.siteName,
    folder: draft.folder,
    owner: context.owner,
    codeSource: draft.codeSource,
    newRepo: isNew ? projectCheckRequest(draft).repo : null,
    localParent: isNew ? draft.localParent.trim() : null,
    template: draft.template,
    server: context.server,
    phpVersion: draft.phpVersion,
    appPort: draft.appPort,
    buildOutput: buildOutputOf(draft),
    spa: isStatic(draft) && draft.spa,
    repoUrl: repoUrlOf(draft),
    branch: draft.branch,
    sourceMode: draft.sourceMode,
    pollMinutes: draft.pollMinutes,
    buildSteps: hasCode ? filledSteps(buildSteps) : [],
    activateSteps: hasCode ? filledSteps(activateSteps) : [],
    database,
    env: hasCode && writesEnv({ ...draft, database }, draft.envText),
    jobs: hasCode && draft.template === 'laravel' ? availableJobs(context.tools, draft.jobs) : NO_JOBS,
    dns: dnsInput(draft, context, zone),
    https: { email: draft.email.trim(), redirect: draft.redirect, staging: draft.staging },
    healthPath: TEMPLATES[draft.template].healthPath
  }
}
