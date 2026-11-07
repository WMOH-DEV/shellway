import type { ProbeDefinition } from '@/types/server/core'
import { emptyEngine, POSTGRES_PROBE } from './facts'
import { isSystemDatabase } from './identifiers'
import { hasSection, sectionLines, splitSections, tabFields, toInt } from './sections'
import type { DbDatabase, DbUser, EngineFacts } from './types'

export const AS_POSTGRES = 'sudo -n -u postgres'

export const PSQL = `${AS_POSTGRES} psql -X`

const SCRIPT = `command -v psql >/dev/null 2>&1 || { echo @@missing; exit 0; }
id postgres >/dev/null 2>&1 || { echo @@missing; exit 0; }
cd /tmp
q() { ${PSQL} -A -t -F "$(printf '\\t')" -c "$1"; }
if ! v=$(q 'SHOW server_version' 2>&1); then echo @@failed; printf '%s\\n' "$v" | head -n 3; exit 0; fi
echo @@version
printf '%s\\n' "$v"
echo @@listen
ss -Hltnp 2>/dev/null | grep -E '"(postgres|postmaster)"' | awk '{print $4}'
echo @@databases
q "SELECT datname, pg_get_userbyid(datdba), pg_database_size(datname) FROM pg_database WHERE NOT datistemplate ORDER BY datname LIMIT 500"
echo @@users
q "SELECT rolname, rolsuper, rolcanlogin FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname LIMIT 200"
`

function failure(lines: string[]): EngineFacts {
  const text = lines.join(' ')
  if (/no such file|could not connect|connection refused|is the server running/i.test(text)) {
    return emptyEngine('postgresql', 'stopped', 'PostgreSQL is installed but not running.')
  }
  if (/password is required|a password is required|not allowed to execute/i.test(text)) {
    return emptyEngine('postgresql', 'no-access', 'root cannot run psql as the postgres user without a password.')
  }
  if (/peer authentication failed/i.test(text)) {
    return emptyEngine('postgresql', 'no-access', 'The postgres user cannot sign in through the local socket (peer authentication is off in pg_hba.conf).')
  }
  return emptyEngine('postgresql', 'no-access', text || 'PostgreSQL did not answer.')
}

function parseDatabase(line: string): DbDatabase {
  const [name, owner, size] = tabFields(line)
  return { name, sizeBytes: toInt(size), tables: null, owner, system: isSystemDatabase('postgresql', name) }
}

function parseRole(line: string, databases: DbDatabase[]): DbUser {
  const [name, superuser, login] = tabFields(line)
  const owned = databases.filter((database) => database.owner === name && !database.system).map((database) => database.name)
  const grants = [
    ...(superuser === 't' ? ['superuser'] : []),
    ...(login === 't' ? [] : ['cannot sign in']),
    ...(owned.length > 0 ? [`owns ${owned.join(', ')}`] : [])
  ]
  return { name, host: null, grants, socketLogin: name === 'postgres', superuser: superuser === 't' }
}

export function parsePostgres(stdout: string): EngineFacts {
  const sections = splitSections(stdout)
  if (hasSection(sections, 'missing')) return emptyEngine('postgresql', 'missing', 'PostgreSQL is not installed.')
  if (hasSection(sections, 'failed')) return failure(sectionLines(sections, 'failed'))
  const databases = sectionLines(sections, 'databases').map(parseDatabase)
  return {
    engine: 'postgresql',
    status: 'ok',
    reason: '',
    flavor: 'postgresql',
    version: (sectionLines(sections, 'version')[0] ?? '').split(' ')[0],
    listen: sectionLines(sections, 'listen'),
    databases,
    users: sectionLines(sections, 'users').map((line) => parseRole(line, databases))
  }
}

export const postgresProbe: ProbeDefinition<EngineFacts> = {
  id: POSTGRES_PROBE,
  area: 'databases',
  root: true,
  timeoutSeconds: 30,
  script: SCRIPT,
  parse: parsePostgres
}
