import { isServiceKind, isValidServiceName, isValidUser } from './control'
import { LOAD_NODE } from './pm2'
import type { ServiceItem } from './list'
import type { LogSource, SystemLogId } from './logChannel'
import { shellQuote } from './sections'

export type { LogSource, SystemLogId } from './logChannel'

export type LogMode = { follow: false; lines: number } | { follow: true }

interface SystemLog {
  id: SystemLogId
  label: string
  files: string[]
  journal: string | null
}

export const SYSTEM_LOGS: readonly SystemLog[] = [
  { id: 'journal', label: 'System journal', files: [], journal: '' },
  { id: 'journal-errors', label: 'System journal, errors only', files: [], journal: '-p err' },
  { id: 'nginx-error', label: 'nginx errors', files: ['/var/log/nginx/error.log'], journal: null },
  { id: 'nginx-access', label: 'nginx access', files: ['/var/log/nginx/access.log'], journal: null },
  { id: 'apache-error', label: 'Apache errors', files: ['/var/log/apache2/error.log', '/var/log/httpd/error_log'], journal: null },
  { id: 'apache-access', label: 'Apache access', files: ['/var/log/apache2/access.log', '/var/log/httpd/access_log'], journal: null },
  { id: 'php-fpm', label: 'PHP-FPM', files: ['/var/log/php*-fpm.log'], journal: null },
  { id: 'mysql-error', label: 'MySQL / MariaDB errors', files: ['/var/log/mysql/error.log', '/var/log/mariadb/mariadb.log', '/var/log/mysqld.log'], journal: '-u mysql.service -u mariadb.service' },
  { id: 'auth', label: 'Logins (auth.log)', files: ['/var/log/auth.log', '/var/log/secure'], journal: '-u ssh.service -u sshd.service' },
  { id: 'syslog', label: 'syslog', files: ['/var/log/syslog', '/var/log/messages'], journal: '' }
]

export const MAX_LOG_LINES = 10000

export const MISSING_LOG_MARKER = '@@missing'

const AUTO_ROOT = `if [ "$(id -u)" = 0 ]; then E=""; elif sudo -n true 2>/dev/null; then E="sudo -n"; else E=""; fi`

function journalCommand(args: string, mode: LogMode): string {
  const tail = mode.follow ? '-n 0 -f' : `-n ${mode.lines}`
  return `exec journalctl --no-pager -o short-iso ${tail}${args ? ` ${args}` : ''}`
}

function systemLogScript(log: SystemLog, mode: LogMode): string {
  if (log.files.length === 0) return journalCommand(log.journal ?? '', mode)
  const tail = mode.follow ? 'tail -n 0 -F' : `tail -n ${mode.lines}`
  return [
    'set --',
    `for f in ${log.files.join(' ')}; do [ -f "$f" ] && set -- "$@" "$f"; done`,
    `if [ $# -gt 0 ]; then exec ${tail} -- "$@"; fi`,
    log.journal === null ? `echo ${MISSING_LOG_MARKER}` : journalCommand(log.journal, mode)
  ].join('\n')
}

function supervisorScript(name: string, mode: LogMode): string {
  const quoted = shellQuote(name)
  return mode.follow ? `exec supervisorctl tail -f ${quoted}` : `exec supervisorctl tail -${Math.min(mode.lines * 300, 1_000_000)} ${quoted}`
}

function pm2Script(name: string, mode: LogMode): string {
  const tail = mode.follow ? '--lines 0' : `--lines ${mode.lines} --nostream`
  return `${LOAD_NODE}\nexec pm2 logs ${shellQuote(name)} --raw ${tail}`
}

function containerScript(name: string, mode: LogMode): string {
  const tail = mode.follow ? '-f --tail 0' : `--tail ${mode.lines}`
  return `exec docker logs ${tail} ${shellQuote(name)} 2>&1`
}

function innerScript(source: LogSource, mode: LogMode): string {
  switch (source.kind) {
    case 'system':
      return systemLogScript(SYSTEM_LOGS.find((log) => log.id === source.id) as SystemLog, mode)
    case 'systemd':
      return journalCommand(`-u ${shellQuote(`${source.name}.service`)}`, mode)
    case 'supervisor':
      return supervisorScript(source.name, mode)
    case 'pm2':
      return pm2Script(source.name, mode)
    case 'container':
      return containerScript(source.name, mode)
  }
}

function elevation(source: LogSource): string {
  if (source.kind !== 'pm2') return AUTO_ROOT
  const user = shellQuote(source.user)
  return `if [ "$(id -un)" = ${user} ]; then E=""; else E="sudo -n -u ${source.user} -H"; fi`
}

export function readLogScript(source: LogSource, lines: number): string {
  return `${elevation(source)}\n$E sh -c ${shellQuote(innerScript(source, { follow: false, lines }))}\n`
}

export function followLogScript(source: LogSource): string {
  return [
    'exec 3<&0',
    elevation(source),
    `$E sh -c ${shellQuote(innerScript(source, { follow: true }))} </dev/null &`,
    'p=$!',
    '{ cat <&3 >/dev/null 2>&1; kill $p 2>/dev/null; } >/dev/null 2>&1 &',
    'exec 3<&-',
    'wait $p 2>/dev/null',
    ''
  ].join('\n')
}

function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid log source')
  return raw as Record<string, unknown>
}

export function parseLogSource(raw: unknown): LogSource {
  const { kind, id, name, user } = record(raw)
  if (kind === 'system') {
    const log = SYSTEM_LOGS.find((candidate) => candidate.id === id)
    if (!log) throw new Error('Unknown log source')
    return { kind, id: log.id }
  }
  if (!isServiceKind(kind) || !isValidServiceName(kind, name)) throw new Error('Invalid log source')
  if (kind !== 'pm2') return { kind, name }
  if (!isValidUser(user)) throw new Error('Invalid log source')
  return { kind, name, user }
}

export function parseLogLines(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > MAX_LOG_LINES) throw new Error('Invalid line count')
  return raw
}

export function logSourceLabel(source: LogSource): string {
  if (source.kind === 'system') return SYSTEM_LOGS.find((log) => log.id === source.id)?.label ?? source.id
  return source.kind === 'pm2' ? `${source.name} (pm2, ${source.user})` : source.name
}

export function serviceLogSource(item: Pick<ServiceItem, 'kind' | 'name' | 'user'>): LogSource {
  return item.kind === 'pm2' ? { kind: 'pm2', name: item.name, user: item.user ?? '' } : { kind: item.kind, name: item.name }
}

export function logSourceKey(source: LogSource): string {
  if (source.kind === 'system') return source.id
  return source.kind === 'pm2' ? `pm2-${source.user}-${source.name}` : `${source.kind}-${source.name}`
}
