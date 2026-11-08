import type { CreateSiteInput, CreateSiteSecrets, TemplateId } from '@/types/createSite'
import { setEnvKeys, type EnvEntry } from '../server/databases/env'
import { DB_PASSWORD, MASK } from '../server/databases/identifiers'
import { databaseEnv } from './database'
import { deployRootOf } from './siteScripts'
import { quote } from '../server/jobs/shell'
import { assertDomain, assertFolder, assertSiteName } from './validate'

type EnvFacts = Pick<CreateSiteInput, 'template' | 'siteName' | 'domain' | 'database'>

const ENV_STACKS: ReadonlySet<TemplateId> = new Set(['laravel', 'php', 'node', 'compose'])
const APP_KEY = /^base64:[A-Za-z0-9+/]{43}=$/
const MAX_ENV_BYTES = 64 * 1024
const SECRET_KEYS: ReadonlySet<string> = new Set(['APP_KEY', 'DB_PASSWORD'])

export const stackUsesEnv = (template: TemplateId): boolean => ENV_STACKS.has(template)

export const envPathOf = (folder: string): string => `${deployRootOf(folder)}/shared/.env`

export function privateEnvFileScript(folder: string): string {
  const file = quote(envPathOf(assertFolder(folder)))
  return ['set -e', `[ -e ${file} ] || (umask 077 && : > ${file})`, `chmod 600 ${file}`, ''].join('\n')
}

export const isSecretKey = (key: string): boolean => SECRET_KEYS.has(key)

function appEntries({ template, siteName, domain }: EnvFacts, appKey: string): EnvEntry[] {
  if (template === 'node') return [['NODE_ENV', 'production']]
  if (template !== 'laravel') return []
  return [
    ['APP_NAME', assertSiteName(siteName)],
    ['APP_ENV', 'production'],
    ['APP_KEY', appKey],
    ['APP_DEBUG', 'false'],
    ['APP_URL', `https://${assertDomain(domain)}`]
  ]
}

export function managedEnv(facts: EnvFacts, secrets: Pick<CreateSiteSecrets, 'appKey' | 'dbPassword'> | null): EnvEntry[] {
  return [...appEntries(facts, secrets?.appKey ?? MASK), ...databaseEnv(facts.database, secrets?.dbPassword ?? MASK)]
}

const ENTRY = /^([A-Z0-9_]+)=(.*)$/

const envEntriesOf = (text: string): EnvEntry[] =>
  text.split('\n').flatMap((line): EnvEntry[] => {
    const match = ENTRY.exec(line.trim())
    return match ? [[match[1], match[2]]] : []
  })

export const withEnvBase = (base: string, userText: string): string => (base.trim() === '' ? userText : setEnvKeys(base, envEntriesOf(userText)))

export const envFileText = (facts: EnvFacts, secrets: CreateSiteSecrets, base = ''): string =>
  setEnvKeys(withEnvBase(base, secrets.envText), managedEnv(facts, secrets))

export const writesEnv = (facts: EnvFacts, userText: string): boolean =>
  stackUsesEnv(facts.template) && (managedEnv(facts, null).length > 0 || userText.trim() !== '')

export function generateAppKey(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32))
  return `base64:${btoa(String.fromCharCode(...bytes))}`
}

function secretsProblem(input: CreateSiteInput, secrets: CreateSiteSecrets): string | null {
  const { database } = input
  const needsPassword = database !== null && database.engine !== 'sqlite'
  if (needsPassword !== (secrets.dbPassword !== null)) return 'The database password does not match the database choice.'
  if (secrets.dbPassword !== null && !DB_PASSWORD.test(secrets.dbPassword)) return 'The database password is not valid.'
  if ((input.template === 'laravel') !== (secrets.appKey !== null)) return 'The app key does not match the stack.'
  if (secrets.appKey !== null && !APP_KEY.test(secrets.appKey)) return 'The app key is not valid.'
  if (new TextEncoder().encode(secrets.envText).length > MAX_ENV_BYTES) return 'The env settings are too long.'
  if (secrets.envText.includes('\0')) return 'The env settings contain a NUL character.'
  return null
}

export function assertSecrets(input: CreateSiteInput, secrets: unknown): CreateSiteSecrets {
  const value = secrets as Partial<CreateSiteSecrets> | null
  const isNullableString = (field: unknown): boolean => field === null || typeof field === 'string'
  if (!value || !isNullableString(value.dbPassword) || !isNullableString(value.appKey) || typeof value.envText !== 'string') throw new Error('Invalid secrets')
  const checked = { dbPassword: value.dbPassword ?? null, appKey: value.appKey ?? null, envText: value.envText }
  const problem = secretsProblem(input, checked)
  if (problem) throw new Error(problem)
  return checked
}

export const maskedEnvLines = (entries: EnvEntry[]): string =>
  entries.map(([key, value]) => `${key}=${isSecretKey(key) ? MASK : value}`).join('\n')
