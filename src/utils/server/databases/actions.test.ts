import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { ActionDefinition, ActionPlan, ServerFacts } from '@/types/server/core'
import { databasesArea } from '../areas/databases'
import { backupNowAction, scheduleBackupsAction } from './actions/backup'
import { createDatabaseAction, createUserAction } from './actions/create'
import { dropDatabaseAction } from './actions/drop'
import { restoreAction } from './actions/restore'
import { changePasswordAction, dropUserAction } from './actions/users'
import { envDiff, setEnvKeys } from './env'
import { BACKUPS_PROBE, MYSQL_PROBE, POSTGRES_PROBE, SITES_PROBE } from './facts'
import { linkedSite, listenPort } from './sites'
import type { BackupFacts, EngineFacts, SiteEnvFacts } from './types'

const PASSWORD = 'Abcdefghijklmnopqrstuvwx'
const FILE = '/var/backups/shellway/db/mysql/shop_prod-20251107-030000.sql.gz'

const mysql: EngineFacts = {
  engine: 'mysql',
  status: 'ok',
  reason: '',
  flavor: 'mysql',
  version: '8.0.39',
  listen: ['0.0.0.0:3306', '127.0.0.1:33060'],
  databases: [
    { name: 'mysql', sizeBytes: 1, tables: 38, owner: null, system: true },
    { name: 'shop_prod', sizeBytes: 100, tables: 64, owner: null, system: false }
  ],
  users: [
    { name: 'root', host: 'localhost', grants: ['ALL on *.*'], socketLogin: true, superuser: true },
    { name: 'shop', host: 'localhost', grants: ['ALL on shop_prod'], socketLogin: false, superuser: false }
  ]
}

const postgres: EngineFacts = {
  engine: 'postgresql',
  status: 'ok',
  reason: '',
  flavor: 'postgresql',
  version: '16.4',
  listen: ['127.0.0.1:5432'],
  databases: [{ name: 'api_prod', sizeBytes: 10, tables: null, owner: 'api', system: false }],
  users: [{ name: 'api', host: null, grants: ['owns api_prod'], socketLogin: false, superuser: false }]
}

const sites: SiteEnvFacts = {
  deployInstalled: true,
  sites: [
    {
      site: 'shop',
      path: '/var/www/shop-deploy/shared/.env',
      readable: true,
      owner: 'deploy:deploy',
      mode: '640',
      sha256: 'a'.repeat(64),
      content: 'APP_NAME=Shop\nDB_CONNECTION=sqlite\n# DB_HOST=127.0.0.1\nDB_USERNAME=shop\n',
      db: { connection: 'sqlite', database: '', username: 'shop' }
    }
  ]
}

const backups: BackupFacts = {
  schedule: null,
  cronContent: null,
  cronSha256: null,
  scriptSha256: null,
  last: null,
  files: [{ path: FILE, engine: 'mysql', database: 'shop_prod', sizeBytes: 10, modifiedAt: 0 }]
}

const ok = <T>(data: T) => ({ status: 'ok' as const, data, at: 0 })

const facts: ServerFacts = {
  [MYSQL_PROBE]: ok(mysql),
  [POSTGRES_PROBE]: ok(postgres),
  [SITES_PROBE]: ok(sites),
  [BACKUPS_PROBE]: ok(backups)
}

function plan<P>(action: ActionDefinition<P>, raw: unknown, current: ServerFacts = facts): ActionPlan {
  return action.plan(action.validate(raw), current)
}

const scripts = (result: ActionPlan): string => result.steps.map((step) => step.script).join('\n')
const displays = (result: ActionPlan): string => result.steps.map((step) => `${step.display}\n${step.diff ?? ''}`).join('\n')

describe('databases.create', () => {
  it('creates database, user and grant, with the password only in the script and secrets', () => {
    const result = plan(createDatabaseAction, { engine: 'mysql', name: 'blog_prod', user: 'blog', password: PASSWORD })
    expect(result.blocked).toBeNull()
    expect(result.steps.map((step) => step.id)).toEqual(['create-database', 'create-user', 'grant'])
    expect(scripts(result)).toContain("CREATE USER 'blog'@'localhost' IDENTIFIED BY 'Abcdefghijklmnopqrstuvwx';")
    expect(displays(result)).not.toContain(PASSWORD)
    expect(displays(result)).toContain("IDENTIFIED BY '••••'")
    expect(result.secrets).toEqual([PASSWORD])
    expect(result.steps[0].rollback).toContain('DROP DATABASE `blog_prod`;')
    expect(result.steps[1].rollback).toContain("DROP USER 'blog'@'localhost';")
  })

  it('only grants access when the user exists', () => {
    const result = plan(createDatabaseAction, { engine: 'mysql', name: 'shop_staging', user: 'shop' })
    expect(result.steps.map((step) => step.id)).toEqual(['create-database', 'grant'])
    expect(result.secrets).toEqual([])
    expect(result.warnings[0]).toMatch(/already exists/)
  })

  it('creates the role first and makes it owner on PostgreSQL', () => {
    const result = plan(createDatabaseAction, { engine: 'postgresql', name: 'blog', user: 'blog', password: PASSWORD })
    expect(result.steps.map((step) => step.id)).toEqual(['create-user', 'create-database'])
    expect(result.steps[1].script).toContain('CREATE DATABASE "blog" OWNER "blog";')
    expect(result.steps[0].script).toContain("sudo -n -u postgres psql -X -q -v ON_ERROR_STOP=1 <<'SHELLWAY_SQL'")
  })

  it('writes the connection into the site env with the password masked in the diff', () => {
    const result = plan(createDatabaseAction, { engine: 'mysql', name: 'shop_new', user: 'shopnew', password: PASSWORD, site: 'shop' })
    const step = result.steps[result.steps.length - 1]
    expect(step.kind).toBe('file-edit')
    expect(step.diff).toContain('+ DB_PASSWORD=••••')
    expect(step.diff).toContain('- DB_CONNECTION=sqlite')
    expect(step.diff).toContain('+ DB_PORT=3306')
    expect(step.diff).not.toContain(PASSWORD)
  })

  it('blocks a duplicate database, a new user without password and an unknown site', () => {
    expect(plan(createDatabaseAction, { engine: 'mysql', name: 'shop_prod', user: 'x', password: PASSWORD }).blocked?.message).toMatch(/already exists/)
    expect(plan(createDatabaseAction, { engine: 'mysql', name: 'new_db', user: 'newuser' }).blocked?.message).toMatch(/password/)
    expect(plan(createDatabaseAction, { engine: 'mysql', name: 'new_db', user: 'newuser', password: PASSWORD, site: 'nope' }).blocked?.message).toMatch(/could not find/)
    expect(plan(createDatabaseAction, { engine: 'mysql', name: 'new_db', user: 'root' }).blocked?.message).toMatch(/system account/)
  })

  it('blocks when the engine was not checked or has no socket access', () => {
    expect(plan(createDatabaseAction, { engine: 'mysql', name: 'a', user: 'b', password: PASSWORD }, {}).blocked?.message).toMatch(/could not be checked/)
    const denied = { [MYSQL_PROBE]: ok({ ...mysql, status: 'no-access', reason: 'no socket' }) }
    expect(plan(createDatabaseAction, { engine: 'mysql', name: 'a', user: 'b', password: PASSWORD }, denied).blocked?.message).toBe('no socket')
  })

  it.each([
    { engine: 'mysql', name: 'a`; DROP DATABASE x; --', user: 'u' },
    { engine: 'mysql', name: 'ok', user: "u'@'%" },
    { engine: 'mysql', name: 'ok', user: 'u', host: "h' OR 1" },
    { engine: 'mysql', name: 'ok', user: 'u', password: "short'" },
    { engine: 'oracle', name: 'ok', user: 'u' },
    { engine: 'mysql', name: 'ok', user: 'u', site: '../etc' }
  ])('rejects unsafe input %#', (raw) => {
    expect(() => createDatabaseAction.validate(raw)).toThrow()
  })
})

describe('databases.create-user', () => {
  it('creates a user with a grant on MySQL and refuses a grant on PostgreSQL', () => {
    const result = plan(createUserAction, { engine: 'mysql', user: 'report', host: '10.0.0.%', password: PASSWORD, database: 'shop_prod' })
    expect(scripts(result)).toContain("GRANT ALL PRIVILEGES ON `shop\\_prod`.* TO 'report'@'10.0.0.%';")
    expect(plan(createUserAction, { engine: 'postgresql', user: 'report', password: PASSWORD, database: 'api_prod' }).blocked).not.toBeNull()
  })
})

describe('databases.change-password', () => {
  it('changes the password and can update the site env', () => {
    const result = plan(changePasswordAction, { engine: 'mysql', user: 'shop', password: PASSWORD, site: 'shop' })
    expect(result.steps.map((step) => step.id)).toEqual(['password', 'site-env'])
    expect(result.steps[0].display).toContain("ALTER USER 'shop'@'localhost' IDENTIFIED BY '••••';")
    expect(result.secrets).toEqual([PASSWORD])
  })

  it('warns about other sites using the user and refuses socket accounts', () => {
    const mysqlSite = { ...sites.sites[0], db: { connection: 'mysql', database: 'shop_prod', username: 'shop' } }
    const current = { ...facts, [SITES_PROBE]: ok({ ...sites, sites: [mysqlSite] }) }
    expect(plan(changePasswordAction, { engine: 'mysql', user: 'shop', password: PASSWORD }, current).warnings[0]).toMatch(/shop also signs in/)
    expect(plan(changePasswordAction, { engine: 'mysql', user: 'root', password: PASSWORD }).blocked?.message).toMatch(/system account/)
  })
})

describe('typed confirmation', () => {
  it('drop database needs the exact name', () => {
    expect(() => dropDatabaseAction.validate({ engine: 'mysql', name: 'shop_prod', confirm: 'shop' })).toThrow(/Type shop_prod/)
    const result = plan(dropDatabaseAction, { engine: 'mysql', name: 'shop_prod', confirm: 'shop_prod', backupFirst: true })
    expect(result.steps.map((step) => step.id)).toEqual(['backup', 'drop'])
    expect(result.steps[1].script).toContain('DROP DATABASE `shop_prod`;')
  })

  it('drop database refuses system databases', () => {
    expect(plan(dropDatabaseAction, { engine: 'mysql', name: 'mysql', confirm: 'mysql' }).blocked?.message).toMatch(/system database/)
  })

  it('drop user needs the exact name and refuses owners', () => {
    expect(() => dropUserAction.validate({ engine: 'mysql', user: 'shop' })).toThrow()
    expect(plan(dropUserAction, { engine: 'mysql', user: 'shop', confirm: 'shop' }).steps[0].script).toContain("DROP USER 'shop'@'localhost';")
    expect(plan(dropUserAction, { engine: 'postgresql', user: 'api', confirm: 'api' }).blocked?.message).toMatch(/owns api_prod/)
  })

  it('restore over an existing database needs the exact name', () => {
    expect(() => restoreAction.validate({ file: FILE, target: 'shop_prod', mode: 'overwrite' })).toThrow()
    const result = plan(restoreAction, { file: FILE, target: 'shop_prod', mode: 'overwrite', confirm: 'shop_prod' })
    expect(result.steps.map((step) => step.id)).toEqual(['safety-backup', 'import'])
    expect(result.steps[1].script).toContain('DROP DATABASE `shop_prod`')
  })
})

describe('databases.restore', () => {
  it('restores into a new database by default and drops it again if loading fails', () => {
    const result = plan(restoreAction, { file: FILE, target: 'shop_copy', mode: 'new' })
    expect(result.steps.map((step) => step.id)).toEqual(['create-database', 'import'])
    expect(result.steps[0].rollback).toContain('DROP DATABASE `shop_copy`;')
    expect(result.steps[1].script).not.toContain('DROP DATABASE')
    expect(result.steps[1].detached).toBe(true)
  })

  it('refuses files outside the backup folder and files not on the server', () => {
    expect(() => restoreAction.validate({ file: '/etc/shadow', target: 'x', mode: 'new' })).toThrow()
    expect(() => restoreAction.validate({ file: '/var/backups/shellway/db/mysql/../../x-20250101-000000.sql.gz', target: 'x', mode: 'new' })).toThrow()
    const other = '/var/backups/shellway/db/mysql/old-20250101-000000.sql.gz'
    expect(plan(restoreAction, { file: other, target: 'x', mode: 'new' }).blocked?.message).toMatch(/no longer on the server/)
  })

  it('uses the original owner for a PostgreSQL restore', () => {
    const file = '/var/backups/shellway/db/postgresql/api_prod-20251107-030000.dump'
    const current = { ...facts, [BACKUPS_PROBE]: ok({ ...backups, files: [{ path: file, engine: 'postgresql' as const, database: 'api_prod', sizeBytes: 1, modifiedAt: 0 }] }) }
    const result = plan(restoreAction, { file, target: 'api_copy', mode: 'new' }, current)
    expect(result.steps[0].script).toContain('CREATE DATABASE "api_copy" OWNER "api";')
    expect(result.steps[1].script).toContain("pg_restore --no-owner --role='api' -d 'api_copy'")
  })
})

describe('backups', () => {
  it('backs up one database as a detached step', () => {
    const step = plan(backupNowAction, { engine: 'mysql', name: 'shop_prod' }).steps[0]
    expect(step.detached).toBe(true)
    expect(step.script).toContain("dump_mysql 'shop_prod'")
  })

  it('schedules with the script and cron file, creating the folder first', () => {
    const result = plan(scheduleBackupsAction, { enabled: true, hour: 3, minute: 0, keepDays: 7 })
    expect(result.steps.map((step) => step.id)).toEqual(['script-dir', 'script', 'cron'])
  })

  it('stops a schedule and can put it back', () => {
    const content = '0 3 * * * root /usr/local/lib/shellway/db-backup.sh 7\n'
    const current = { [BACKUPS_PROBE]: ok({ ...backups, cronContent: content, schedule: { hour: 3, minute: 0, keepDays: 7 } }) }
    const step = plan(scheduleBackupsAction, { enabled: false, hour: 3, minute: 0, keepDays: 7 }, current).steps[0]
    expect(step.script).toContain('rm -f /etc/cron.d/shellway-db-backups')
    expect(step.rollback).toContain(content)
  })

  it('rejects out of range schedule values', () => {
    expect(() => scheduleBackupsAction.validate({ enabled: true, hour: 24, minute: 0, keepDays: 7 })).toThrow()
    expect(() => scheduleBackupsAction.validate({ enabled: true, hour: 3, minute: 0, keepDays: 0 })).toThrow()
  })
})

describe('every planned script is valid sh', () => {
  const plans = [
    plan(createDatabaseAction, { engine: 'mysql', name: 'blog_prod', user: 'blog', password: PASSWORD }),
    plan(createDatabaseAction, { engine: 'postgresql', name: 'blog', user: 'blog', password: PASSWORD }),
    plan(dropDatabaseAction, { engine: 'mysql', name: 'shop_prod', confirm: 'shop_prod', backupFirst: true }),
    plan(restoreAction, { file: FILE, target: 'shop_prod', mode: 'overwrite', confirm: 'shop_prod' }),
    plan(restoreAction, { file: FILE, target: 'shop_copy', mode: 'new' }),
    plan(scheduleBackupsAction, { enabled: true, hour: 3, minute: 0, keepDays: 7 })
  ]
  it.each(plans.flatMap((result) => result.steps.filter((step) => step.kind === 'command').flatMap((step) => [step.script, step.rollback ?? ''])))('%#', (script) => {
    expect(() => execFileSync('sh', ['-n'], { input: script })).not.toThrow()
  })
})

describe('env editing', () => {
  it('replaces active keys, uncomments commented ones and appends the rest', () => {
    const content = 'APP_NAME=Shop\nDB_CONNECTION=sqlite\n# DB_HOST=127.0.0.1\n'
    expect(setEnvKeys(content, [['DB_CONNECTION', 'mysql'], ['DB_HOST', '127.0.0.1'], ['DB_DATABASE', 'shop']])).toBe('APP_NAME=Shop\nDB_CONNECTION=mysql\nDB_HOST=127.0.0.1\nDB_DATABASE=shop\n')
  })

  it('leaves a commented key alone when an active one exists', () => {
    expect(setEnvKeys('# DB_HOST=old\nDB_HOST=x\n', [['DB_HOST', 'y']])).toBe('# DB_HOST=old\nDB_HOST=y\n')
  })

  it('shows only changed keys and masks the password', () => {
    expect(envDiff('DB_DATABASE=shop\nDB_PASSWORD=old\n', [['DB_DATABASE', 'shop'], ['DB_PASSWORD', 'new']])).toBe('- DB_PASSWORD=••••\n+ DB_PASSWORD=••••')
  })
})

describe('sites', () => {
  it('links databases by env first, then by name', () => {
    const list = [{ ...sites.sites[0], db: { connection: 'mysql', database: 'store', username: 'shop' } }]
    expect(linkedSite('mysql', 'store', list)).toEqual({ site: 'shop', byName: false })
    expect(linkedSite('mysql', 'shop_staging', list)).toEqual({ site: 'shop', byName: true })
    expect(linkedSite('postgresql', 'store', list)).toBeNull()
  })

  it('picks the main port, not the X protocol port', () => {
    expect(listenPort('mysql', ['127.0.0.1:33060', '127.0.0.1:3307'])).toBe(3307)
    expect(listenPort('postgresql', [])).toBe(5432)
  })
})

describe('attention', () => {
  it('flags a failed backup, public MySQL and missing schedule', () => {
    const current = { ...facts, [BACKUPS_PROBE]: ok({ ...backups, last: { ok: false, at: 0, saved: 0, failed: 1, note: 'mysql:shop_prod' } }) }
    expect(databasesArea.attention(current).map((item) => [item.id, item.level, item.rank])).toEqual([
      ['databases.backup-failed', 'error', 130],
      ['databases.mysql-public', 'warning', 75],
      ['databases.no-backups', 'info', 15]
    ])
  })

  it('is quiet when backups are scheduled and MySQL is local', () => {
    const current = {
      [MYSQL_PROBE]: ok({ ...mysql, listen: ['127.0.0.1:3306'] }),
      [BACKUPS_PROBE]: ok({ ...backups, schedule: { hour: 3, minute: 0, keepDays: 7 }, last: { ok: true, at: 0, saved: 1, failed: 0, note: '' } })
    }
    expect(databasesArea.attention(current)).toEqual([])
  })
})
