import type { DbEngine } from './types'

export const DB_NAME = /^[A-Za-z0-9_]{1,64}$/
export const DB_USER = /^[A-Za-z0-9_]{1,32}$/
export const DB_HOST = /^[A-Za-z0-9.%_:-]{1,255}$/
export const DB_PASSWORD = /^[A-Za-z0-9_]{16,64}$/
export const ENGINES: readonly DbEngine[] = ['mysql', 'postgresql']

export const MASK = '••••'

const SYSTEM_DATABASES: Record<DbEngine, readonly string[]> = {
  mysql: ['mysql', 'information_schema', 'performance_schema', 'sys'],
  postgresql: ['postgres', 'template0', 'template1']
}

const PROTECTED_USERS: Record<DbEngine, readonly string[]> = {
  mysql: ['root', 'debian-sys-maint', 'mariadb.sys'],
  postgresql: ['postgres']
}

export const isSystemDatabase = (engine: DbEngine, name: string): boolean => SYSTEM_DATABASES[engine].includes(name)

export const isProtectedUser = (engine: DbEngine, name: string): boolean => PROTECTED_USERS[engine].includes(name)

export function mysqlIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

export function mysqlString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

export function mysqlAccount(user: string, host: string): string {
  return `${mysqlString(user)}@${mysqlString(host)}`
}

export function pgIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export function pgString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}
