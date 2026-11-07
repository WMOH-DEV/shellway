import type { ActionDefinition, ActionPlan, ActionStep, ServerFacts } from '@/types/server/core'
import { DIALECT } from '../dialect'
import { MYSQL_PROBE, POSTGRES_PROBE, SITES_PROBE, siteEnvFacts } from '../facts'
import { DB_HOST, DB_NAME, DB_PASSWORD, DB_USER, ENGINES, isProtectedUser } from '../identifiers'
import { asParams, matching, optionalMatching, pick, type RawParams } from '../params'
import { accountLabel, blockedPlan, findUser, hasDatabase, makePlan, withEngine } from '../plan'
import { connectionEntries, SITE_NAME, siteEnvProblem, siteEnvStep } from '../sites'
import { sqlStep } from '../sqlStep'
import type { DbEngine, EngineFacts, SiteEnv } from '../types'

export interface CreateDatabaseParams {
  engine: DbEngine
  name: string
  user: string
  host: string
  password?: string
  site?: string
}

export interface CreateUserParams {
  engine: DbEngine
  user: string
  host: string
  password: string
  database?: string
}

export function readHost(params: RawParams, engine: DbEngine): string {
  return engine === 'mysql' ? (optionalMatching(params, 'host', DB_HOST) ?? 'localhost') : 'localhost'
}

function createUserStep(engine: DbEngine, user: string, host: string, password: string): ActionStep {
  const dialect = DIALECT[engine]
  return sqlStep({
    id: 'create-user',
    label: `Create user ${accountLabel(engine, user, host)}`,
    engine,
    statements: (secret) => [dialect.createUser(user, host, secret)],
    secret: password,
    rollback: [dialect.dropUser(user, host)]
  })
}

function createDatabaseStep(engine: DbEngine, name: string, owner?: string): ActionStep {
  const dialect = DIALECT[engine]
  return sqlStep({
    id: 'create-database',
    label: `Create database ${name}`,
    engine,
    statements: () => [dialect.createDatabase(name, owner)],
    rollback: [dialect.dropDatabase(name)]
  })
}

function grantStep(engine: DbEngine, database: string, user: string, host: string): ActionStep {
  return sqlStep({
    id: 'grant',
    label: `Let ${accountLabel(engine, user, host)} use ${database}`,
    engine,
    statements: () => [DIALECT[engine].grantAll(database, user, host)]
  })
}

function databaseSteps(params: CreateDatabaseParams, isNewUser: boolean): ActionStep[] {
  const { engine, name, user, host, password } = params
  const userStep = isNewUser && password ? [createUserStep(engine, user, host, password)] : []
  if (engine === 'postgresql') return [...userStep, createDatabaseStep(engine, name, user)]
  return [createDatabaseStep(engine, name), ...userStep, grantStep(engine, name, user, host)]
}

function createProblem(params: CreateDatabaseParams, data: EngineFacts, site: SiteEnv | undefined): string | null {
  if (hasDatabase(data, params.name)) return `A database named ${params.name} already exists.`
  const existing = findUser(data, params.user, params.host)
  if (existing && isProtectedUser(params.engine, params.user)) return `${params.user} is a system account. Pick another user name.`
  if (!existing && !params.password) return 'The new user needs a password.'
  return params.site ? siteEnvProblem(site, params.site) : null
}

function planCreateDatabase(params: CreateDatabaseParams, facts: ServerFacts, data: EngineFacts, title: string): ActionPlan {
  const site = params.site ? siteEnvFacts(facts)?.sites.find((candidate) => candidate.site === params.site) : undefined
  const problem = createProblem(params, data, site)
  if (problem) return blockedPlan(title, problem)
  const isNewUser = !findUser(data, params.user, params.host)
  const password = isNewUser ? params.password : undefined
  const envStep = site ? [siteEnvStep(site, connectionEntries(data, params.name, params.user, password))] : []
  return makePlan({
    title,
    summary: `Creates the database ${params.name}${isNewUser ? ` and the user ${params.user}` : ''} and lets that user use it.`,
    steps: [...databaseSteps(params, isNewUser), ...envStep],
    warnings: isNewUser ? [] : [`${params.user} already exists, so it only gets access. Its password does not change${site ? ' and DB_PASSWORD in the env file stays as it is' : ''}.`],
    secrets: password ? [password] : []
  })
}

export const createDatabaseAction: ActionDefinition<CreateDatabaseParams> = {
  type: 'databases.create',
  area: 'databases',
  needs: [MYSQL_PROBE, POSTGRES_PROBE, SITES_PROBE],
  validate(raw) {
    const params = asParams(raw)
    const engine = pick(params, 'engine', ENGINES)
    return {
      engine,
      name: matching(params, 'name', DB_NAME),
      user: matching(params, 'user', DB_USER),
      host: readHost(params, engine),
      password: optionalMatching(params, 'password', DB_PASSWORD),
      site: optionalMatching(params, 'site', SITE_NAME)
    }
  },
  plan(params, facts) {
    const title = `Create database ${params.name}`
    return withEngine(facts, params.engine, title, (data) => planCreateDatabase(params, facts, data, title))
  }
}

function createUserProblem(params: CreateUserParams, data: EngineFacts): string | null {
  if (findUser(data, params.user, params.host)) return `The user ${accountLabel(params.engine, params.user, params.host)} already exists.`
  if (!params.database) return null
  if (params.engine === 'postgresql') return 'On PostgreSQL, give a user a database by making it the owner when you create the database.'
  return hasDatabase(data, params.database) ? null : `There is no database named ${params.database}.`
}

function planCreateUser(params: CreateUserParams, data: EngineFacts, title: string): ActionPlan {
  const problem = createUserProblem(params, data)
  if (problem) return blockedPlan(title, problem)
  const { engine, user, host, password, database } = params
  return makePlan({
    title,
    summary: database ? `Creates ${accountLabel(engine, user, host)} and lets it use ${database}.` : `Creates ${accountLabel(engine, user, host)}.`,
    steps: [createUserStep(engine, user, host, password), ...(database ? [grantStep(engine, database, user, host)] : [])],
    secrets: [password]
  })
}

export const createUserAction: ActionDefinition<CreateUserParams> = {
  type: 'databases.create-user',
  area: 'databases',
  needs: [MYSQL_PROBE, POSTGRES_PROBE],
  validate(raw) {
    const params = asParams(raw)
    const engine = pick(params, 'engine', ENGINES)
    return {
      engine,
      user: matching(params, 'user', DB_USER),
      host: readHost(params, engine),
      password: matching(params, 'password', DB_PASSWORD),
      database: optionalMatching(params, 'database', DB_NAME)
    }
  },
  plan(params, facts) {
    const title = `Create user ${params.user}`
    return withEngine(facts, params.engine, title, (data) => planCreateUser(params, data, title))
  }
}
