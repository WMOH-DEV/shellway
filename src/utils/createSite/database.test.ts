import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DATABASE_CHECKED, createDatabaseScript } from './database'

const PASSWORD = 'Pw7kQ2mZx9Rt_Lb4NcV8sHj3'
const MYSQL = { engine: 'mysql' as const, name: 'shop', user: 'shop' }

let bin = ''

beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), 'createsite-db-'))
  writeFileSync(join(bin, 'mysql'), [
    '#!/bin/sh',
    'case "$*" in *-e*) echo "${EXISTING:-0}"; exit 0 ;; esac',
    'sql=$(cat)',
    `printf '%s\\n' "$sql" >> "${bin}/sql.log"`,
    'case "$sql" in *"CREATE USER"*) [ -n "$REFUSE_USER" ] && { echo "ERROR 1819: Your password does not satisfy the current policy requirements" >&2; exit 1; } ;; esac',
    'exit 0',
    ''
  ].join('\n'))
  chmodSync(join(bin, 'mysql'), 0o755)
})

afterEach(() => rmSync(bin, { recursive: true, force: true }))

const run = (env: Record<string, string> = {}) =>
  spawnSync('sh', ['-s'], { input: createDatabaseScript(MYSQL, 'deploy', PASSWORD), encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env } })

const sqlLog = (): string => {
  try {
    return readFileSync(join(bin, 'sql.log'), 'utf8')
  } catch {
    return ''
  }
}

describe('createDatabaseScript for MySQL', () => {
  it('says the name is free, then creates the database, the user and the grant', () => {
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(DATABASE_CHECKED)
    expect(sqlLog()).toContain('CREATE USER')
    expect(sqlLog()).not.toContain('DROP')
  })

  it('refuses a name that is taken before saying it is free', () => {
    const result = run({ EXISTING: '1' })
    expect(result.status).toBe(3)
    expect(result.stdout).not.toContain(DATABASE_CHECKED)
    expect(sqlLog()).toBe('')
  })

  it('removes what it made when MySQL refuses the user, so a retry starts clean', () => {
    const result = run({ REFUSE_USER: '1' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('The database server refused to create shop. What was made was removed again.')
    expect(sqlLog()).toContain("DROP DATABASE IF EXISTS `shop`;\nDROP USER IF EXISTS 'shop'@'localhost';")
  })
})
