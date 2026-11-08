import type { CreateSiteInput, DatabaseEngine, ServerDatabaseEngine, ServerTools, SiteDatabase, TemplateId } from '@/types/createSite'
import { EXIT_REFUSED } from '../ssl/originCa/exitCodes'
import { DIALECT } from '../server/databases/dialect'
import { DB_NAME, DB_PASSWORD, DB_USER, MASK } from '../server/databases/identifiers'
import { PSQL } from '../server/databases/postgres'
import { sqlScript } from '../server/databases/sqlStep'
import { deployRootOf } from './siteScripts'
import { assertOwner } from './validate'

export type DatabaseChoice = DatabaseEngine | 'none'

const DB_HOST = 'localhost'
const MAX_USER_LENGTH = 32

const ENGINE_LABELS: Record<DatabaseEngine, string> = { mysql: 'MySQL', postgresql: 'PostgreSQL', sqlite: 'SQLite' }

const SQLITE_STACKS: ReadonlySet<TemplateId> = new Set(['laravel', 'php'])
const SERVER_DATABASE_STACKS: ReadonlySet<TemplateId> = new Set(['laravel', 'php', 'node'])

const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

export const engineLabel = (engine: DatabaseEngine): string => ENGINE_LABELS[engine]

export function databaseChoices(template: TemplateId, tools: ServerTools): DatabaseEngine[] {
  if (!SERVER_DATABASE_STACKS.has(template)) return []
  const servers = (['mysql', 'postgresql'] as const).filter((engine) => tools.databases[engine])
  return SQLITE_STACKS.has(template) ? [...servers, 'sqlite'] : servers
}

export const needsDatabase = (template: TemplateId): boolean => template === 'laravel'

export const defaultDatabase = (template: TemplateId, tools: ServerTools): DatabaseChoice => databaseChoices(template, tools)[0] ?? 'none'

function assertMatches(value: string, pattern: RegExp, what: string): string {
  if (!pattern.test(value)) throw new Error(`${JSON.stringify(value)} is not a valid ${what}`)
  return value
}

export function databaseNames(siteName: string): { name: string; user: string } {
  const base = siteName.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return {
    name: assertMatches(base.slice(0, 64), DB_NAME, 'database name'),
    user: assertMatches(base.slice(0, MAX_USER_LENGTH).replace(/_+$/, ''), DB_USER, 'database user')
  }
}

export const sqlitePath = (folder: string): string => `${deployRootOf(folder)}/shared/database.sqlite`

export function siteDatabase(choice: DatabaseChoice, input: Pick<CreateSiteInput, 'siteName' | 'folder'>): SiteDatabase | null {
  if (choice === 'none') return null
  if (choice === 'sqlite') return { engine: 'sqlite', path: sqlitePath(input.folder) }
  return { engine: choice, ...databaseNames(input.siteName) }
}

export const databaseLabel = (database: SiteDatabase): string =>
  database.engine === 'sqlite' ? `SQLite file ${database.path}` : `${engineLabel(database.engine)} database ${database.name}, user ${database.user}`

export const DATABASE_CHECKED = 'shellway: database name is free'

const refuse = (message: string): string[] => [`  echo ${quote(message)} >&2`, `  exit ${EXIT_REFUSED}`]

const EXISTS_QUERY: Record<ServerDatabaseEngine, (name: string, user: string) => string> = {
  mysql: (name, user) => `mysql --batch -N -e "SELECT (SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${name}') + (SELECT COUNT(*) FROM mysql.user WHERE User='${user}')"`,
  postgresql: (name, user) => `${PSQL} -tA -c "SELECT (SELECT COUNT(*) FROM pg_database WHERE datname='${name}') + (SELECT COUNT(*) FROM pg_roles WHERE rolname='${user}')"`
}

function createStatements(engine: ServerDatabaseEngine, name: string, user: string, password: string): string[] {
  const dialect = DIALECT[engine]
  if (engine === 'postgresql') return [dialect.createUser(user, DB_HOST, password), dialect.createDatabase(name, user)]
  return [dialect.createDatabase(name), dialect.createUser(user, DB_HOST, password), dialect.grantAll(name, user, DB_HOST)]
}

function dropStatements(engine: ServerDatabaseEngine, name: string, user: string): string[] {
  return engine === 'mysql'
    ? [`DROP DATABASE IF EXISTS \`${name}\`;`, `DROP USER IF EXISTS '${user}'@'${DB_HOST}';`]
    : [`DROP DATABASE IF EXISTS "${name}";`, `DROP ROLE IF EXISTS "${user}";`]
}

function createServerDatabaseScript(engine: ServerDatabaseEngine, name: string, user: string, password: string): string {
  return [
    'set -e',
    'cd /tmp',
    `found=$(${EXISTS_QUERY[engine](name, user)})`,
    'if [ "$found" != 0 ]; then',
    ...refuse(`A database or user named ${name === user ? name : `${name} or ${user}`} already exists. Nothing was changed.`),
    'fi',
    `echo ${quote(DATABASE_CHECKED)}`,
    'if ! {',
    sqlScript(engine, createStatements(engine, name, user, password)).trimEnd(),
    '}; then',
    '  set +e',
    sqlScript(engine, dropStatements(engine, name, user)).trimEnd(),
    `  echo ${quote(`The database server refused to create ${name}. What was made was removed again.`)} >&2`,
    '  exit 1',
    'fi',
    ''
  ].join('\n')
}

function createSqliteScript(path: string, owner: string): string {
  const file = quote(path)
  return [
    'set -e',
    `if [ -e ${file} ] || [ -L ${file} ]; then`,
    ...refuse(`${path} already exists. Nothing was changed.`),
    'fi',
    `echo ${quote(DATABASE_CHECKED)}`,
    `(umask 077 && : > ${file})`,
    `chown ${quote(`${assertOwner(owner)}:`)} ${file}`,
    ''
  ].join('\n')
}

export function createDatabaseScript(database: SiteDatabase, owner: string, password: string | null): string {
  if (database.engine === 'sqlite') return createSqliteScript(database.path, owner)
  const secret = password === null ? MASK : assertMatches(password, DB_PASSWORD, 'database password')
  return createServerDatabaseScript(database.engine, database.name, database.user, secret)
}

export function removeDatabaseScript(database: SiteDatabase): string {
  if (database.engine === 'sqlite') {
    const file = quote(database.path)
    return ['set -e', `rm -f ${file} ${quote(`${database.path}-wal`)} ${quote(`${database.path}-shm`)}`, ''].join('\n')
  }
  return ['set -e', 'cd /tmp', sqlScript(database.engine, dropStatements(database.engine, database.name, database.user))].join('\n')
}

export function databaseEnv(database: SiteDatabase | null, password: string): [string, string][] {
  if (database === null) return []
  if (database.engine === 'sqlite') return [['DB_CONNECTION', 'sqlite'], ['DB_DATABASE', database.path]]
  const isMysql = database.engine === 'mysql'
  return [
    ['DB_CONNECTION', isMysql ? 'mysql' : 'pgsql'],
    ['DB_HOST', isMysql ? DB_HOST : '127.0.0.1'],
    ['DB_PORT', isMysql ? '3306' : '5432'],
    ['DB_DATABASE', database.name],
    ['DB_USERNAME', database.user],
    ['DB_PASSWORD', password]
  ]
}
