import type { ServerRoute } from '@/types/server/core'
import type { ControlParams } from './control'
import type { FixParams } from './fix'
import type { ServiceItem } from './list'
import type { FailedDetails, Listener } from './types'

export type HintFix =
  | { kind: 'control'; label: string; params: ControlParams }
  | { kind: 'fix'; label: string; params: FixParams }
  | { kind: 'route'; label: string; route: ServerRoute }
  | { kind: 'show'; label: string; text: string }
  | { kind: 'logs'; label: string }

export interface ServiceHint {
  id: string
  text: string
  fix: HintFix | null
}

export interface HintInput {
  item: Pick<ServiceItem, 'kind' | 'name' | 'user' | 'state' | 'detail'>
  lines: string[]
  failed: FailedDetails | null
}

interface HintRule {
  id: string
  match(input: HintInput, log: string): Omit<ServiceHint, 'id'> | null
}

export const DISK_ROUTE: ServerRoute = { section: 'overview', sub: 'metrics' }

function controlFix(input: HintInput, verb: 'start' | 'restart', label: string): HintFix {
  return { kind: 'control', label, params: { kind: input.item.kind, name: input.item.name, verb, user: input.item.user } }
}

function busyPort(log: string): number | null {
  const match = /:(\d+)\D[^\n]*Address already in use/.exec(log) ?? /port (\d+)[^\n]*Address already in use/i.exec(log) ?? /Address already in use[^\n]*?:(\d+)/.exec(log)
  return match ? Number(match[1]) : null
}

function portOwner(port: number | null, listeners: Listener[]): Listener | null {
  return port === null ? null : (listeners.find((listener) => listener.port === port && listener.process) ?? null)
}

function deniedPath(log: string): string | null {
  return /(\/[\w.@/-]+)[^\n]*Permission denied/.exec(log)?.[1] ?? /Permission denied[^\n]*?(\/[\w.@/-]+)/.exec(log)?.[1] ?? null
}

const RULES: HintRule[] = [
  {
    id: 'fail2ban-no-log',
    match: (input, log) => {
      if (input.item.name !== 'fail2ban' || !/Have not found any log file for \w+ jail/i.test(log)) return null
      return { text: 'fail2ban cannot find the SSH log file. Newer Debian and Ubuntu systems keep SSH logins in the journal, so the jail needs backend = systemd. Set up fail2ban from Security to fix it.', fix: { kind: 'route', label: 'Open Security', route: { section: 'security' } } }
    }
  },
  {
    id: 'php-fpm-bind',
    match: (input, log) => {
      if (!/^php[\d.]*-fpm$/.test(input.item.name) || !/unable to bind listening socket/i.test(log)) return null
      return { text: 'PHP-FPM cannot open its socket. An old socket file or another pool is usually in the way, and a restart clears a stale socket.', fix: controlFix(input, 'restart', 'Restart') }
    }
  },
  {
    id: 'port-in-use',
    match: (input, log) => {
      if (!/Address already in use/i.test(log)) return null
      const port = busyPort(log)
      const owner = portOwner(port, input.failed?.listeners ?? [])
      const portText = port === null ? 'Its port' : `Port ${port}`
      const ownerText = owner ? ` is already taken by ${owner.process}` : ' is already taken by another program'
      return {
        text: `${portText}${ownerText}, so ${input.item.name} can't listen on it. Stop the other program or move one of them to a different port.`,
        fix: owner ? { kind: 'show', label: 'Show who uses the port', text: `${owner.address}  ${owner.process}` } : null
      }
    }
  },
  {
    id: 'nginx-config',
    match: (input, log) => {
      const test = input.failed?.nginxTest ?? ''
      if (input.item.name !== 'nginx' || !/test failed|\[emerg\]/.test(`${test}\n${log}`)) return null
      return { text: 'nginx will not start because a config file has an error. The test names the file and line.', fix: test ? { kind: 'show', label: 'Show nginx -t', text: test } : null }
    }
  },
  {
    id: 'apache-config',
    match: (input, log) => {
      const test = input.failed?.apacheTest ?? ''
      if (input.item.name !== 'apache2' || !/Syntax error|AH00526/.test(`${test}\n${log}`)) return null
      return { text: 'Apache will not start because a config file has an error. The test names the file and line.', fix: test ? { kind: 'show', label: 'Show configtest', text: test } : null }
    }
  },
  {
    id: 'disk-full',
    match: (input, log) => {
      if (!/No space left on device/i.test(log)) return null
      return { text: `The disk is full, so ${input.item.name} can't write its files. Free up space, then start it again.`, fix: { kind: 'route', label: 'Free disk space', route: DISK_ROUTE } }
    }
  },
  {
    id: 'redis-log',
    match: (input, log) => {
      if (!/^redis(-server)?$/.test(input.item.name) || !/Can't open the log file/i.test(log)) return null
      return {
        text: "The log file isn't writable by the redis user. Fix: chown redis:redis /var/log/redis/redis-server.log, then start.",
        fix: { kind: 'fix', label: 'Fix and start', params: { fix: 'redis-log-owner', unit: input.item.name } }
      }
    }
  },
  {
    id: 'supervisor-command',
    match: (input, log) => {
      if (input.item.kind !== 'supervisor' || !/spawn ?err|can't find command|No such file or directory|not executable/i.test(log)) return null
      return { text: "Supervisor can't run the program's command: the file is missing or not executable. Check the command and folder in the worker settings.", fix: { kind: 'route', label: 'Open workers', route: { section: 'jobs' } } }
    }
  },
  {
    id: 'start-limit',
    match: (input, log) => {
      if (input.item.kind !== 'systemd' || !/start-limit-hit|Start request repeated too quickly/.test(log)) return null
      return { text: 'systemd gave up after it failed several times in a row. Fix the cause, then start it again.', fix: controlFix(input, 'start', 'Start') }
    }
  },
  {
    id: 'permission-denied',
    match: (input, log) => {
      if (!/Permission denied/i.test(log)) return null
      const path = deniedPath(log)
      return { text: `${input.item.name} can't read or write ${path ?? 'a file or folder it needs'}. Check who owns it.`, fix: null }
    }
  },
  {
    id: 'supervisor-backoff',
    match: (input) => {
      if (input.item.kind !== 'supervisor' || input.item.state !== 'failed') return null
      return { text: 'The program exits right after it starts. Its error output usually says why.', fix: { kind: 'logs', label: 'Open logs' } }
    }
  },
  {
    id: 'pm2-errored',
    match: (input) => {
      if (input.item.kind !== 'pm2' || input.item.state !== 'failed') return null
      return { text: 'The app keeps crashing right after it starts. Its error log usually shows why.', fix: { kind: 'logs', label: 'Open logs' } }
    }
  }
]

export function findHint(input: HintInput): ServiceHint | null {
  const log = [...input.lines, input.item.detail].join('\n')
  for (const rule of RULES) {
    const hint = rule.match(input, log)
    if (hint) return { id: rule.id, ...hint }
  }
  return null
}

export function failureLines(item: Pick<ServiceItem, 'kind' | 'name'>, failed: FailedDetails | null): string[] {
  if (!failed) return []
  if (item.kind === 'systemd') return failed.units[item.name] ?? []
  if (item.kind === 'supervisor') return failed.programs[item.name] ?? []
  return []
}
