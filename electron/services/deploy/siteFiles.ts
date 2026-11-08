import type { DeployStep, SiteConfig } from '../../../src/types/deploy'

type ConfKey =
  | 'SITE_PATH' | 'REPO_URL' | 'BRANCH' | 'SOURCE_MODE' | 'LAYOUT' | 'SHARED_PATHS' | 'ENV_FILE'
  | 'HEALTH_URL' | 'HEALTH_STATUS' | 'HEALTH_REVERT' | 'KEEP_RELEASES' | 'POLL_MINUTES'
  | 'APPROVE_MIGRATIONS' | 'MIGRATIONS_PATH' | 'PC_AUTO' | 'QUIET_HOURS' | 'NOTIFY_URL'

const SITE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/
const BRANCH_NAME = /^[A-Za-z0-9._/-]+$/
const CONTROL_CHARS = /[\x00-\x1f\x7f]/

export function isValidSiteName(name: string): boolean {
  return SITE_NAME.test(name)
}

export function isValidBranch(branch: string): boolean {
  return BRANCH_NAME.test(branch) && !branch.includes('..') && !branch.startsWith('-')
}

export function quoteShellValue(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

export function unquoteShellValue(raw: string): string {
  let out = ''
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (ch === "'") {
      const close = raw.indexOf("'", i + 1)
      const end = close === -1 ? raw.length : close
      out += raw.slice(i + 1, end)
      i = end + 1
    } else if (ch === '\\' && i + 1 < raw.length) {
      out += raw[i + 1]
      i += 2
    } else {
      out += ch
      i += 1
    }
  }
  return out
}

const flag = (value: boolean): string => (value ? '1' : '0')

function confEntries(c: SiteConfig): [ConfKey, string][] {
  return [
    ['SITE_PATH', c.path],
    ['REPO_URL', c.repoUrl],
    ['BRANCH', c.branch],
    ['SOURCE_MODE', c.sourceMode],
    ['LAYOUT', c.layout],
    ['SHARED_PATHS', c.sharedPaths.join(' ')],
    ['ENV_FILE', c.envFile],
    ['HEALTH_URL', c.healthUrl],
    ['HEALTH_STATUS', String(c.healthStatus)],
    ['HEALTH_REVERT', flag(c.autoRevert)],
    ['KEEP_RELEASES', String(c.keepReleases)],
    ['POLL_MINUTES', String(c.pollMinutes)],
    ['APPROVE_MIGRATIONS', flag(c.approveMigrations)],
    ['MIGRATIONS_PATH', c.migrationsPath],
    ['PC_AUTO', flag(c.pcAuto)],
    ['QUIET_HOURS', c.quietHours],
    ['NOTIFY_URL', c.notifyUrl]
  ]
}

export function serializeSiteConf(c: SiteConfig): string {
  return confEntries(c).map(([key, value]) => `${key}=${quoteShellValue(value)}\n`).join('')
}

const stepKind = (s: DeployStep): string => `${s.optional ? 'O' : 'R'}${s.timeoutSeconds ? `:${s.timeoutSeconds}` : ''}`

export function serializeSteps(steps: DeployStep[]): string {
  return steps.map((s) => `${stepKind(s)}\t${s.command}\n`).join('')
}

function parseStepKind(kind: string): Pick<DeployStep, 'optional' | 'timeoutSeconds'> {
  const [letter, seconds] = kind.split(':')
  const timeout = Number.parseInt(seconds ?? '', 10)
  return { optional: letter === 'O', timeoutSeconds: timeout > 0 ? timeout : null }
}

export function parseSteps(text: string): DeployStep[] {
  return text
    .split('\n')
    .map((line) => {
      const tab = line.indexOf('\t')
      if (tab === -1) return null
      const command = line.slice(tab + 1)
      return command ? { ...parseStepKind(line.slice(0, tab)), command } : null
    })
    .filter((s): s is DeployStep => s !== null)
}

export function parseConf(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line)
    if (match) values[match[1]] = unquoteShellValue(match[2])
  }
  return values
}

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function parseSiteFiles(name: string, conf: string, build: string, activate: string): SiteConfig {
  const v = parseConf(conf)
  return {
    name,
    path: v.SITE_PATH ?? '',
    repoUrl: v.REPO_URL ?? '',
    branch: v.BRANCH || 'main',
    sourceMode: v.SOURCE_MODE === 'pc' ? 'pc' : 'auto',
    layout: v.LAYOUT === 'inplace' ? 'inplace' : 'releases',
    sharedPaths: (v.SHARED_PATHS ?? '').split(' ').filter(Boolean),
    envFile: v.ENV_FILE || '.env',
    healthUrl: v.HEALTH_URL ?? '',
    healthStatus: toInt(v.HEALTH_STATUS, 200),
    autoRevert: v.HEALTH_REVERT !== '0',
    keepReleases: toInt(v.KEEP_RELEASES, 5),
    pollMinutes: toInt(v.POLL_MINUTES, 1),
    approveMigrations: v.APPROVE_MIGRATIONS === '1',
    migrationsPath: v.MIGRATIONS_PATH || 'database/migrations',
    pcAuto: v.PC_AUTO === '1',
    quietHours: v.QUIET_HOURS ?? '',
    notifyUrl: v.NOTIFY_URL ?? '',
    buildSteps: parseSteps(build),
    activateSteps: parseSteps(activate)
  }
}

const isSafeRelativePath = (p: string): boolean =>
  p.length > 0 && !p.startsWith('/') && !/[\s*?[\]]/.test(p) && !CONTROL_CHARS.test(p) && !p.split('/').includes('..')

const trimSlashes = (p: string) => p.replace(/\/+$/, '')

const hasNestedPath = (paths: string[]): boolean =>
  paths.map(trimSlashes).some((a, i, all) => all.some((b, j) => i !== j && (a === b || b.startsWith(`${a}/`))))

const inRange = (n: number, min: number, max: number): boolean => Number.isInteger(n) && n >= min && n <= max

const QUIET_HOURS = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/
const MAX_STEP_SECONDS = 86_400

export function isValidQuietHours(value: string): boolean {
  if (value === '') return true
  const [start, end] = value.split('-')
  return QUIET_HOURS.test(value) && start !== end
}

export function isValidNotifyUrl(value: string): boolean {
  return value === '' || /^https?:\/\/[^\s'"\\]+$/.test(value)
}

function validateSteps(steps: DeployStep[]): string | null {
  for (const step of steps) {
    if (!step.command.trim()) return 'Steps cannot be empty'
    if (CONTROL_CHARS.test(step.command)) return 'Each step must be a single line without tabs'
    if (step.timeoutSeconds !== null && !inRange(step.timeoutSeconds, 1, MAX_STEP_SECONDS)) return 'Time limit must be between 1 second and 24 hours'
  }
  return null
}

export function validateSiteConfig(c: SiteConfig): string | null {
  if (!isValidSiteName(c.name)) return 'Name must be lowercase letters, numbers and dashes (max 40)'
  if (!c.path.startsWith('/') || c.path.replace(/\/+$/, '') === '' || CONTROL_CHARS.test(c.path)) {
    return 'Path must be an absolute folder other than /'
  }
  if (!c.repoUrl || c.repoUrl.startsWith('-') || /\s/.test(c.repoUrl) || CONTROL_CHARS.test(c.repoUrl)) return 'Repository URL is required'
  if (!isValidBranch(c.branch)) return 'Branch name is not valid'
  if (!c.sharedPaths.every(isSafeRelativePath)) return 'Shared paths must be relative, without spaces, wildcards or ..'
  if (hasNestedPath(c.sharedPaths)) return 'Shared paths cannot be inside one another'
  if (!isSafeRelativePath(c.envFile)) return 'Env file must be a relative path'
  if (!isSafeRelativePath(c.migrationsPath)) return 'Migrations folder must be a relative path'
  if (c.healthUrl && !/^https?:\/\/\S+$/.test(c.healthUrl)) return 'Health check URL must start with http:// or https://'
  if (!inRange(c.healthStatus, 100, 599)) return 'Expected status must be between 100 and 599'
  if (!inRange(c.keepReleases, 1, 50)) return 'Releases to keep must be between 1 and 50'
  if (!inRange(c.pollMinutes, 1, 60)) return 'Check interval must be between 1 and 60 minutes'
  if (!isValidQuietHours(c.quietHours)) return 'Quiet hours must look like 22:00-06:00'
  if (!isValidNotifyUrl(c.notifyUrl)) return 'Notification URL must start with http:// or https://'
  return validateSteps([...c.buildSteps, ...c.activateSteps])
}
