import type { ActionDefinition, ActionPlan, ActionStep, ServerFacts } from '@/types/server/core'
import { BACKUP_FILE } from '../backupScripts'
import { DIALECT } from '../dialect'
import { backupFacts, BACKUPS_PROBE, MYSQL_PROBE, POSTGRES_PROBE } from '../facts'
import { DB_NAME, isSystemDatabase, mysqlIdent, shellQuote } from '../identifiers'
import { asParams, confirmed, matching, pick } from '../params'
import { blockedPlan, hasDatabase, makePlan, withEngine } from '../plan'
import { AS_POSTGRES } from '../postgres'
import { sqlStep } from '../sqlStep'
import type { DbEngine, EngineFacts } from '../types'
import { dumpStep } from './backup'

export type RestoreMode = 'new' | 'overwrite'

export interface RestoreParams {
  file: string
  engine: DbEngine
  target: string
  mode: RestoreMode
}

const RESTORE_TIMEOUT_SECONDS = 3600

function mysqlImportScript(file: string, target: string, recreate: boolean): string {
  return [
    `f=${shellQuote(file)}`,
    'flag=$(mktemp)',
    ...(recreate ? [`mysql --batch -e ${shellQuote(`DROP DATABASE ${mysqlIdent(target)}; ${DIALECT.mysql.createDatabase(target)}`)} || exit 1`] : []),
    `{ gunzip -c "$f" || echo failed > "$flag"; } | mysql --batch ${shellQuote(target)} || { rm -f "$flag"; exit 1; }`,
    'if [ -s "$flag" ]; then rm -f "$flag"; exit 1; fi',
    'rm -f "$flag"',
    ''
  ].join('\n')
}

function mysqlImportDisplay(file: string, target: string, recreate: boolean): string {
  const recreateLine = recreate ? [`mysql -e "DROP DATABASE ${mysqlIdent(target)}; CREATE DATABASE ${mysqlIdent(target)} CHARACTER SET utf8mb4;"`] : []
  return [...recreateLine, `gunzip -c ${file} | mysql ${target}`].join('\n')
}

function postgresImportCommand(file: string, target: string, owner: string, clean: boolean): string {
  const cleanFlags = clean ? ' --clean --if-exists' : ''
  return `(cd /tmp && ${AS_POSTGRES} pg_restore${cleanFlags} --no-owner --role=${shellQuote(owner)} -d ${shellQuote(target)}) < ${shellQuote(file)}`
}

function importStep(params: RestoreParams, owner: string): ActionStep {
  const overwrite = params.mode === 'overwrite'
  const isMysql = params.engine === 'mysql'
  const script = isMysql ? mysqlImportScript(params.file, params.target, overwrite) : `${postgresImportCommand(params.file, params.target, owner, overwrite)}\n`
  return {
    id: 'import',
    label: `Load the backup into ${params.target}`,
    kind: 'command',
    root: true,
    script,
    display: isMysql ? mysqlImportDisplay(params.file, params.target, overwrite) : script.trim(),
    timeoutSeconds: RESTORE_TIMEOUT_SECONDS,
    detached: true
  }
}

function ownerFor(data: EngineFacts, name: string): string {
  return data.databases.find((database) => database.name === name && !database.system)?.owner ?? 'postgres'
}

function sourceDatabase(file: string): string {
  return BACKUP_FILE.exec(file)?.[2] ?? ''
}

function newDatabasePlan(params: RestoreParams, data: EngineFacts, title: string): ActionPlan {
  if (hasDatabase(data, params.target)) return blockedPlan(title, `A database named ${params.target} already exists. Pick a new name, or choose to replace it.`)
  const owner = ownerFor(data, sourceDatabase(params.file))
  const dialect = DIALECT[params.engine]
  const create = sqlStep({
    id: 'create-database',
    label: `Create database ${params.target}`,
    engine: params.engine,
    statements: () => [dialect.createDatabase(params.target, params.engine === 'postgresql' ? owner : undefined)],
    rollback: [dialect.dropDatabase(params.target)]
  })
  return makePlan({ title, summary: `Loads the backup into a new database ${params.target}. Existing databases are not touched.`, steps: [create, importStep(params, owner)] })
}

function overwritePlan(params: RestoreParams, data: EngineFacts, title: string): ActionPlan {
  if (isSystemDatabase(params.engine, params.target)) return blockedPlan(title, `${params.target} is a system database. Shellway does not replace it.`)
  if (!hasDatabase(data, params.target)) return blockedPlan(title, `There is no database named ${params.target}.`)
  return makePlan({
    title,
    summary: `Saves a backup of ${params.target}, then replaces its data with the backup file.`,
    steps: [dumpStep(params.engine, params.target, 'safety-backup'), importStep(params, ownerFor(data, params.target))],
    warnings: [`Everything in ${params.target} is replaced. A backup of the current data is saved first.`]
  })
}

function planRestore(params: RestoreParams, facts: ServerFacts): ActionPlan {
  const title = `Restore into ${params.target}`
  const files = backupFacts(facts)?.files ?? []
  if (!files.some((file) => file.path === params.file)) return blockedPlan(title, 'That backup file is no longer on the server. Refresh and try again.')
  return withEngine(facts, params.engine, title, (data) => (params.mode === 'new' ? newDatabasePlan(params, data, title) : overwritePlan(params, data, title)))
}

export const restoreAction: ActionDefinition<RestoreParams> = {
  type: 'databases.restore',
  area: 'databases',
  needs: [MYSQL_PROBE, POSTGRES_PROBE, BACKUPS_PROBE],
  validate(raw) {
    const params = asParams(raw)
    const file = matching(params, 'file', BACKUP_FILE)
    const target = matching(params, 'target', DB_NAME)
    const mode = pick(params, 'mode', ['new', 'overwrite'] as const)
    if (mode === 'overwrite') confirmed(params, target)
    return { file, engine: BACKUP_FILE.exec(file)?.[1] as DbEngine, target, mode }
  },
  plan: planRestore
}
