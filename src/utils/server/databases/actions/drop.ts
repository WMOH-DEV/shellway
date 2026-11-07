import type { ActionDefinition, ActionPlan, ServerFacts } from '@/types/server/core'
import { DIALECT } from '../dialect'
import { MYSQL_PROBE, POSTGRES_PROBE, SITES_PROBE, siteEnvFacts } from '../facts'
import { DB_NAME, ENGINES, isSystemDatabase } from '../identifiers'
import { asParams, confirmed, flag, matching, pick } from '../params'
import { blockedPlan, hasDatabase, makePlan, withEngine } from '../plan'
import { linkedSite } from '../sites'
import { sqlStep } from '../sqlStep'
import type { DbEngine, EngineFacts } from '../types'
import { dumpStep } from './backup'

export interface DropDatabaseParams {
  engine: DbEngine
  name: string
  backupFirst: boolean
}

function planDrop(params: DropDatabaseParams, facts: ServerFacts, data: EngineFacts, title: string): ActionPlan {
  const { engine, name, backupFirst } = params
  if (isSystemDatabase(engine, name)) return blockedPlan(title, `${name} is a system database. Shellway does not drop it.`)
  if (!hasDatabase(data, name)) return blockedPlan(title, `There is no database named ${name}.`)
  const site = linkedSite(engine, name, siteEnvFacts(facts)?.sites ?? [])
  const drop = sqlStep({ id: 'drop', label: `Drop ${name}`, engine, statements: () => [DIALECT[engine].dropDatabase(name)] })
  return makePlan({
    title,
    summary: backupFirst ? `Saves a backup of ${name}, then deletes the database and all its data.` : `Deletes ${name} and all its data. There is no undo.`,
    steps: backupFirst ? [dumpStep(engine, name), drop] : [drop],
    warnings: [
      ...(site ? [`${site.site} ${site.byName ? 'looks like it uses' : 'uses'} this database. It will stop working.`] : []),
      ...(backupFirst ? [] : ['No backup is made first.'])
    ]
  })
}

export const dropDatabaseAction: ActionDefinition<DropDatabaseParams> = {
  type: 'databases.drop-database',
  area: 'databases',
  needs: [MYSQL_PROBE, POSTGRES_PROBE, SITES_PROBE],
  validate(raw) {
    const params = asParams(raw)
    const name = matching(params, 'name', DB_NAME)
    confirmed(params, name)
    return { engine: pick(params, 'engine', ENGINES), name, backupFirst: flag(params, 'backupFirst') }
  },
  plan(params, facts) {
    const title = `Drop database ${params.name}`
    return withEngine(facts, params.engine, title, (data) => planDrop(params, facts, data, title))
  }
}
