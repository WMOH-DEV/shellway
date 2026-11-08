import type { ProbeDefinition } from '@/types/server/core'
import { emptyEngine, flavorLabel, MYSQL_PROBE } from './facts'
import { isSystemDatabase } from './identifiers'
import { hasSection, sectionLines, splitSections, tabFields, toInt, type OutputSection } from './sections'
import type { DbDatabase, DbFlavor, DbUser, EngineFacts, SignInFix } from './types'

export const MYSQL_CLIENT = 'mysql --batch --skip-column-names'

const USERS_FILTER = "User NOT LIKE 'mysql.%'"

const SCRIPT = `command -v mysql >/dev/null 2>&1 || { echo @@missing; exit 0; }
cd /tmp
echo @@client
mysql --version 2>/dev/null | head -n 1
q() { ${MYSQL_CLIENT} -e "$1"; }
if ! v=$(q 'SELECT VERSION()' 2>&1); then echo @@failed; printf '%s\\n' "$v" | head -n 3; exit 0; fi
echo @@version
printf '%s\\n' "$v"
echo @@listen
ss -Hltnp 2>/dev/null | grep -E '"(mysqld|mariadbd)"' | awk '{print $4}'
echo @@databases
q "SELECT s.SCHEMA_NAME, COALESCE(SUM(t.DATA_LENGTH + t.INDEX_LENGTH), 0), COUNT(t.TABLE_NAME) FROM information_schema.SCHEMATA s LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME GROUP BY s.SCHEMA_NAME ORDER BY s.SCHEMA_NAME LIMIT 500"
echo @@users
q "SELECT User, Host, plugin FROM mysql.user WHERE ${USERS_FILTER} ORDER BY User, Host LIMIT 200"
q "SELECT CONCAT(QUOTE(User), '@', QUOTE(Host)) FROM mysql.user WHERE ${USERS_FILTER} ORDER BY User, Host LIMIT 50" | while IFS= read -r who; do
  echo "@@grants $who"
  q "SHOW GRANTS FOR $who" 2>/dev/null | head -n 20
done
`

const SOCKET_PLUGINS = ['auth_socket', 'unix_socket']

interface Client {
  flavor: DbFlavor
  version: string
}

function parseClient(line: string): Client {
  if (!/mariadb/i.test(line)) return { flavor: 'mysql', version: /Ver (\d+\.\d+\.\d+)/.exec(line)?.[1] ?? '' }
  return { flavor: 'mariadb', version: /(\d+\.\d+\.\d+)-MariaDB/i.exec(line)?.[1] ?? '' }
}

const MY_CNF: SignInFix = {
  name: '/root/.my.cnf',
  label: 'Save root\'s password as /root/.my.cnf, then run sudo chmod 600 /root/.my.cnf so only root can read it. Nothing in the database changes.',
  code: '[client]\nuser=root\npassword=your-root-password'
}

const MARIADB_SOCKET: SignInFix = {
  name: 'the ALTER USER command',
  label: 'Or let root also sign in through the socket. Run this in sudo mysql -p. Apps that use root\'s password keep working.',
  code: "ALTER USER root@localhost IDENTIFIED VIA unix_socket OR mysql_native_password USING PASSWORD('your-root-password');"
}

function atLeast(version: string, major: number, minor: number): boolean {
  const [a, b] = version.split('.').map(Number)
  return a > major || (a === major && b >= minor)
}

const signInFixes = ({ flavor, version }: Client): SignInFix[] => (flavor === 'mariadb' && atLeast(version, 10, 4) ? [MY_CNF, MARIADB_SOCKET] : [MY_CNF])

function failure(lines: string[], client: Client): EngineFacts {
  const name = flavorLabel(client.flavor)
  const text = lines.join(' ')
  const facts = (status: 'stopped' | 'no-access', reason: string): EngineFacts => ({ ...emptyEngine('mysql', status, reason), flavor: client.flavor })
  if (/can't connect|no such file|connection refused/i.test(text)) return facts('stopped', `${name} is installed but not running.`)
  if (/access denied/i.test(text)) {
    return { ...facts('no-access', `root cannot sign in to ${name} without a password. Shellway runs mysql as root and never types a password, so root needs another way in.`), signInFixes: signInFixes(client) }
  }
  return facts('no-access', text || `${name} did not answer.`)
}

function parseDatabase(line: string): DbDatabase {
  const [name, size, tables] = tabFields(line)
  return { name, sizeBytes: toInt(size), tables: toInt(tables), owner: null, system: isSystemDatabase('mysql', name) }
}

function cleanTarget(target: string): string {
  const plain = target.replace(/[`'"]/g, '').replace(/\\_/g, '_').replace(/\\%/g, '%')
  return plain !== '*.*' && plain.endsWith('.*') ? plain.slice(0, -2) : plain
}

const ALL_THRESHOLD = 25

function privilegeLabel(privileges: Set<string>): string {
  if (privileges.has('ALL') || privileges.has('ALL PRIVILEGES') || privileges.size >= ALL_THRESHOLD) return 'ALL'
  if (privileges.size <= 3) return [...privileges].join(', ')
  return `${privileges.size} privileges`
}

const GRANT = /^GRANT (.+?) ON (?:(?:FUNCTION|PROCEDURE) )?(\S+) TO /

const SKIPPED = ['USAGE', 'PROXY']

function privilegesByTarget(lines: string[]): Map<string, Set<string>> {
  const byTarget = new Map<string, Set<string>>()
  for (const line of lines) {
    const match = GRANT.exec(line)
    if (!match) continue
    const privileges = match[1].split(',').map((privilege) => privilege.trim()).filter((privilege) => privilege && !SKIPPED.includes(privilege))
    if (privileges.length === 0) continue
    const target = cleanTarget(match[2])
    const set = byTarget.get(target) ?? new Set<string>()
    privileges.forEach((privilege) => set.add(privilege))
    byTarget.set(target, set)
  }
  return byTarget
}

const hasAllOnEverything = (byTarget: Map<string, Set<string>>): boolean => {
  const global = byTarget.get('*.*')
  return global !== undefined && privilegeLabel(global) === 'ALL'
}

function summarize(byTarget: Map<string, Set<string>>): string[] {
  const targetsByLabel = new Map<string, string[]>()
  for (const [target, privileges] of byTarget) {
    const label = privilegeLabel(privileges)
    targetsByLabel.set(label, [...(targetsByLabel.get(label) ?? []), target])
  }
  return [...targetsByLabel].map(([label, targets]) => `${label} on ${targets.join(', ')}`)
}

export const summarizeGrants = (lines: string[]): string[] => summarize(privilegesByTarget(lines))

function grantLines(sections: OutputSection[], user: string, host: string): string[] {
  const who = `'${user.replace(/'/g, "\\'")}'@'${host.replace(/'/g, "\\'")}'`
  return sections.find((section) => section.name === 'grants' && section.arg === who)?.lines ?? []
}

function parseUser(line: string, sections: OutputSection[]): DbUser {
  const [name, host, plugin] = tabFields(line)
  const grants = grantLines(sections, name, host)
  const byTarget = privilegesByTarget(grants)
  return {
    name,
    host,
    grants: summarize(byTarget),
    socketLogin: SOCKET_PLUGINS.includes(plugin) || grants.some((grant) => /unix_socket|auth_socket/.test(grant)),
    superuser: hasAllOnEverything(byTarget)
  }
}

export function parseMysql(stdout: string): EngineFacts {
  const sections = splitSections(stdout)
  if (hasSection(sections, 'missing')) return emptyEngine('mysql', 'missing', 'MySQL is not installed.')
  if (hasSection(sections, 'failed')) return failure(sectionLines(sections, 'failed'), parseClient(sectionLines(sections, 'client')[0] ?? ''))
  const version = sectionLines(sections, 'version')[0] ?? ''
  return {
    engine: 'mysql',
    status: 'ok',
    reason: '',
    flavor: /mariadb/i.test(version) ? 'mariadb' : 'mysql',
    version: version.split('-')[0],
    listen: sectionLines(sections, 'listen'),
    databases: sectionLines(sections, 'databases').map(parseDatabase),
    users: sectionLines(sections, 'users').map((line) => parseUser(line, sections))
  }
}

export const mysqlProbe: ProbeDefinition<EngineFacts> = {
  id: MYSQL_PROBE,
  area: 'databases',
  root: true,
  timeoutSeconds: 30,
  script: SCRIPT,
  parse: parseMysql
}
