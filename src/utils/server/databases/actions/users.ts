import type { ActionDefinition, ActionPlan, ServerFacts } from '@/types/server/core'
import { DIALECT } from '../dialect'
import { MYSQL_PROBE, POSTGRES_PROBE, SITES_PROBE, siteEnvFacts } from '../facts'
import { DB_PASSWORD, DB_USER, ENGINES, isProtectedUser } from '../identifiers'
import { asParams, confirmed, matching, optionalMatching, pick } from '../params'
import { accountLabel, blockedPlan, findUser, makePlan, withEngine } from '../plan'
import { SITE_NAME, siteEnvProblem, siteEnvStep, sitesUsingUser } from '../sites'
import { sqlStep } from '../sqlStep'
import type { DbEngine, DbUser, EngineFacts } from '../types'
import { readHost } from './create'

export interface ChangePasswordParams {
  engine: DbEngine
  user: string
  host: string
  password: string
  site?: string
}

export interface DropUserParams {
  engine: DbEngine
  user: string
  host: string
}

function userProblem(engine: DbEngine, user: DbUser | undefined, label: string): string | null {
  if (!user) return `There is no user ${label}.`
  if (isProtectedUser(engine, user.name) || user.socketLogin) return `${label} is a system account. Shellway does not change it.`
  return null
}

function planChangePassword(params: ChangePasswordParams, facts: ServerFacts, data: EngineFacts, title: string): ActionPlan {
  const { engine, user, host, password } = params
  const label = accountLabel(engine, user, host)
  const site = params.site ? siteEnvFacts(facts)?.sites.find((candidate) => candidate.site === params.site) : undefined
  const problem = userProblem(engine, findUser(data, user, host), label) ?? (params.site ? siteEnvProblem(site, params.site) : null)
  if (problem) return blockedPlan(title, problem)
  if (site && site.db.username !== user) return blockedPlan(title, `${site.site} does not use ${user}.`)
  const others = sitesUsingUser(engine, user, siteEnvFacts(facts)?.sites ?? []).filter((candidate) => candidate.site !== site?.site)
  return makePlan({
    title,
    summary: `Gives ${label} a new password${site ? ` and writes it into ${site.site}'s env file` : ''}.`,
    steps: [
      sqlStep({ id: 'password', label: `Set a new password for ${label}`, engine, statements: (secret) => [DIALECT[engine].setPassword(user, host, secret)], secret: password }),
      ...(site ? [siteEnvStep(site, [['DB_PASSWORD', password]])] : [])
    ],
    warnings: others.map((other) => `${other.site} also signs in as ${user}. Update DB_PASSWORD in its env file, or it stops working.`),
    secrets: [password]
  })
}

export const changePasswordAction: ActionDefinition<ChangePasswordParams> = {
  type: 'databases.change-password',
  area: 'databases',
  needs: [MYSQL_PROBE, POSTGRES_PROBE, SITES_PROBE],
  validate(raw) {
    const params = asParams(raw)
    const engine = pick(params, 'engine', ENGINES)
    return {
      engine,
      user: matching(params, 'user', DB_USER),
      host: readHost(params, engine),
      password: matching(params, 'password', DB_PASSWORD),
      site: optionalMatching(params, 'site', SITE_NAME)
    }
  },
  plan(params, facts) {
    const title = `Change the password of ${params.user}`
    return withEngine(facts, params.engine, title, (data) => planChangePassword(params, facts, data, title))
  }
}

function ownedDatabases(data: EngineFacts, user: string): string[] {
  return data.databases.filter((database) => database.owner === user).map((database) => database.name)
}

function planDropUser(params: DropUserParams, facts: ServerFacts, data: EngineFacts, title: string): ActionPlan {
  const { engine, user, host } = params
  const label = accountLabel(engine, user, host)
  const problem = userProblem(engine, findUser(data, user, host), label)
  if (problem) return blockedPlan(title, problem)
  const owned = ownedDatabases(data, user)
  if (owned.length > 0) return blockedPlan(title, `${user} owns ${owned.join(', ')}. Drop those databases or give them another owner first.`)
  const sites = sitesUsingUser(engine, user, siteEnvFacts(facts)?.sites ?? [])
  return makePlan({
    title,
    summary: `Deletes the user ${label}. Databases are not touched.`,
    steps: [sqlStep({ id: 'drop-user', label: `Drop user ${label}`, engine, statements: () => [DIALECT[engine].dropUser(user, host)] })],
    warnings: sites.map((site) => `${site.site} signs in as ${user}. It will stop working.`)
  })
}

export const dropUserAction: ActionDefinition<DropUserParams> = {
  type: 'databases.drop-user',
  area: 'databases',
  needs: [MYSQL_PROBE, POSTGRES_PROBE, SITES_PROBE],
  validate(raw) {
    const params = asParams(raw)
    const engine = pick(params, 'engine', ENGINES)
    const user = matching(params, 'user', DB_USER)
    confirmed(params, user)
    return { engine, user, host: readHost(params, engine) }
  },
  plan(params, facts) {
    const title = `Drop user ${params.user}`
    return withEngine(facts, params.engine, title, (data) => planDropUser(params, facts, data, title))
  }
}
