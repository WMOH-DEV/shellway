import type { CloudflareZoneRef, CreateSiteContext, CreateSiteInput, DnsInput, NameCheck, PlanActionId, ServerTools, SiteServer, TemplateId } from '@/types/createSite'
import type { SourceMode } from '@/types/deploy'
import { newSite, siteNameFromPath } from '../deploy/presets'
import { isValidEmail } from '../ssl/https/issueCommands'
import { webServerDriver, type WebServerDriver } from '../webServer'
import { templateAvailability } from './availability'
import { phpNeed } from './php'
import { TEMPLATES, usesPhp } from './templates'
import { assertDomain, assertFolder, assertPort, assertSiteName } from './validate'

export const WIZARD_STEPS = ['site', 'code', 'domain', 'review'] as const

export type WizardStep = (typeof WIZARD_STEPS)[number]

export const STEP_TITLES: Record<WizardStep | 'create', string> = {
  site: 'Site and template',
  code: 'Code',
  domain: 'Domain and HTTPS',
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
}

export interface NameCheckState {
  domain: string
  result: NameCheck | null
  error: string | null
}

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[]

const DEFAULT_APP_PORT = 3000
const MAX_POLL_MINUTES = 60

const ACTION_STEPS: Record<PlanActionId, WizardStep> = {
  php: 'site',
  composer: 'site',
  pm2: 'site',
  folder: 'site',
  modules: 'site',
  site: 'site',
  dns: 'domain',
  https: 'domain',
  deploys: 'code',
  'first-deploy': 'code'
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
  return {
    domain: '',
    includeWww: true,
    siteName: '',
    folder: '',
    template: firstUsableTemplate(tools),
    phpVersion: tools.php.installed[0] ?? tools.php.installable[0] ?? '',
    appPort: DEFAULT_APP_PORT,
    repoUrl: '',
    branch,
    sourceMode,
    pollMinutes,
    proxied: true,
    email: '',
    redirect: true,
    staging: true
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

function templateProblem(draft: CreateSiteDraft, tools: ServerTools): string | null {
  const template = TEMPLATES[draft.template]
  const availability = templateAvailability(draft.template, tools)
  if (availability.state === 'blocked') return `${template.label} cannot be used here: ${availability.reason}`
  if (usesPhp(template) && phpNeed(tools.php, draft.phpVersion).kind === 'unavailable') return 'Pick a PHP version'
  if (template.proxiesToApp && fails(() => assertPort(draft.appPort))) return 'Enter an app port from 1 to 65535'
  return null
}

export function siteStepProblem(draft: CreateSiteDraft, check: NameCheckState | null, context: CreateSiteContext): string | null {
  if (fails(() => assertDomain(draft.domain))) return 'Enter a domain such as shop.example.com'
  const nameProblem = nameCheckProblem(check, draft.domain)
  if (nameProblem !== null) return nameProblem
  if (fails(() => assertSiteName(draft.siteName))) return 'Site name: lowercase letters, digits, dots and dashes'
  if (context.deploySiteNames.includes(draft.siteName)) return `There is already a site named ${draft.siteName}`
  if (fails(() => assertFolder(draft.folder))) return 'Enter the folder as a full path, such as /var/www/shop'
  return templateProblem(draft, context.tools)
}

export function codeStepProblem(draft: CreateSiteDraft): string | null {
  if (draft.repoUrl === '') return 'Enter the repository'
  if (draft.branch === '') return 'Enter the branch'
  const { pollMinutes } = draft
  if (draft.sourceMode === 'auto' && (!Number.isInteger(pollMinutes) || pollMinutes < 1 || pollMinutes > MAX_POLL_MINUTES)) {
    return `Check for new commits every 1 to ${MAX_POLL_MINUTES} minutes`
  }
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

export function toInput(draft: CreateSiteDraft, context: ServerContext, zone: CloudflareZoneRef | null): CreateSiteInput {
  const { proxied: _proxied, email, redirect, staging, ...site } = draft
  return {
    ...site,
    owner: context.owner,
    server: context.server,
    dns: dnsInput(draft, context, zone),
    https: { email: email.trim(), redirect, staging },
    healthPath: TEMPLATES[draft.template].healthPath
  }
}
