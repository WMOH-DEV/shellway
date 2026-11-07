import { mysqlAccount, mysqlIdent, mysqlString, pgIdent, pgString } from './identifiers'
import type { DbEngine } from './types'

export interface Dialect {
  createDatabase(name: string, owner?: string): string
  dropDatabase(name: string): string
  createUser(user: string, host: string, password: string): string
  dropUser(user: string, host: string): string
  setPassword(user: string, host: string, password: string): string
  grantAll(database: string, user: string, host: string): string
}

const mysql: Dialect = {
  createDatabase: (name) => `CREATE DATABASE ${mysqlIdent(name)} CHARACTER SET utf8mb4;`,
  dropDatabase: (name) => `DROP DATABASE ${mysqlIdent(name)};`,
  createUser: (user, host, password) => `CREATE USER ${mysqlAccount(user, host)} IDENTIFIED BY ${mysqlString(password)};`,
  dropUser: (user, host) => `DROP USER ${mysqlAccount(user, host)};`,
  setPassword: (user, host, password) => `ALTER USER ${mysqlAccount(user, host)} IDENTIFIED BY ${mysqlString(password)};`,
  grantAll: (database, user, host) => `GRANT ALL PRIVILEGES ON ${mysqlIdent(database.replace(/[_%]/g, '\\$&'))}.* TO ${mysqlAccount(user, host)};`
}

const PG_QUIET_LOG = "SET log_statement = 'none';\nSET log_min_error_statement = panic;"

const postgresql: Dialect = {
  createDatabase: (name, owner) => `CREATE DATABASE ${pgIdent(name)}${owner ? ` OWNER ${pgIdent(owner)}` : ''};`,
  dropDatabase: (name) => `DROP DATABASE ${pgIdent(name)};`,
  createUser: (user, _host, password) => `${PG_QUIET_LOG}\nCREATE ROLE ${pgIdent(user)} LOGIN PASSWORD ${pgString(password)};`,
  dropUser: (user) => `DROP ROLE ${pgIdent(user)};`,
  setPassword: (user, _host, password) => `${PG_QUIET_LOG}\nALTER ROLE ${pgIdent(user)} WITH PASSWORD ${pgString(password)};`,
  grantAll: (database, user) => `GRANT ALL PRIVILEGES ON DATABASE ${pgIdent(database)} TO ${pgIdent(user)};`
}

export const DIALECT: Record<DbEngine, Dialect> = { mysql, postgresql }
