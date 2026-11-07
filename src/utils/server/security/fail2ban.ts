import type { ProbeDefinition } from '@/types/server/core'
import { ROOT_PRELUDE, fileWithSha, firstLine, hasRoot, sections, sshClientPart, trackedFile, type TrackedFile } from './shell'

export const FAIL2BAN_PROBE = 'security.fail2ban'
export const SHELLWAY_JAIL = '/etc/fail2ban/jail.d/shellway.local'

export interface BannedIp {
  ip: string
  minutesLeft: number | null
}

export interface Fail2banJail {
  banned: BannedIp[]
  currentlyFailed: number
  totalBanned: number
  ignoreIp: string[]
  bantime: number | null
  findtime: number | null
  maxretry: number | null
}

export interface Fail2banFacts {
  root: boolean
  installed: boolean
  running: boolean
  jails: string[]
  sshd: Fail2banJail | null
  clientIp: string
  osId: string
  osVersion: string
  jailFile: TrackedFile | null
}

const script = [
  ROOT_PRELUDE,
  'echo "@@installed"; if [ -x /usr/bin/fail2ban-client ]; then echo yes; else echo no; fi',
  'echo "@@running"; systemctl is-active fail2ban 2>/dev/null',
  'echo "@@os"; ( . /etc/os-release 2>/dev/null; echo "$ID"; echo "$VERSION_ID" )',
  'echo "@@session"; echo "$SSH_CONNECTION"',
  'if [ -x /usr/bin/fail2ban-client ] && systemctl is-active --quiet fail2ban 2>/dev/null; then',
  '  echo "@@status"; asroot fail2ban-client status 2>/dev/null',
  '  echo "@@sshd"; asroot fail2ban-client status sshd 2>/dev/null',
  '  echo "@@ignoreip"; asroot fail2ban-client get sshd ignoreip 2>/dev/null',
  '  echo "@@times"; for k in bantime findtime maxretry; do printf "%s=%s\\n" "$k" "$(asroot fail2ban-client get sshd $k 2>/dev/null)"; done',
  '  echo "@@now"; date "+%Y-%m-%d %H:%M:%S"',
  '  echo "@@bantimes"; asroot fail2ban-client get sshd banip --with-time 2>/dev/null',
  'fi',
  fileWithSha('jail', SHELLWAY_JAIL, false)
].join('\n')

const field = (lines: string[], label: string): string => {
  const line = lines.find((candidate) => candidate.includes(`${label}:`))
  return line ? line.slice(line.indexOf(`${label}:`) + label.length + 1).trim() : ''
}

export function parseJailList(lines: string[]): string[] {
  return field(lines, 'Jail list').split(/[,\s]+/).filter(Boolean)
}

export function parseIgnoreIp(lines: string[]): string[] {
  return lines.map((line) => /^[|`]-\s*(\S+)/.exec(line.trim())?.[1] ?? '').filter(Boolean)
}

const toTime = (value: string): number => Date.parse(value.replace(' ', 'T'))

export function parseBanTimes(lines: string[], now: string): Map<string, number> {
  const result = new Map<string, number>()
  const reference = toTime(now)
  for (const line of lines) {
    const match = /^(\S+)\s+.*=\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*$/.exec(line.trim())
    if (!match || Number.isNaN(reference)) continue
    const end = toTime(match[2])
    if (!Number.isNaN(end)) result.set(match[1], Math.max(0, Math.ceil((end - reference) / 60000)))
  }
  return result
}

const numberOrNull = (value: string | undefined): number | null => {
  const parsed = Number(value)
  return value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : null
}

function parseJail(parts: Map<string, string[]>): Fail2banJail | null {
  const lines = parts.get('sshd') ?? []
  if (!lines.some((line) => line.includes('Status for the jail'))) return null
  const minutes = parseBanTimes(parts.get('bantimes') ?? [], firstLine(parts, 'now'))
  const times = new Map((parts.get('times') ?? []).map((line) => line.split('=') as [string, string]))
  return {
    banned: field(lines, 'Banned IP list').split(/\s+/).filter(Boolean).map((ip) => ({ ip, minutesLeft: minutes.get(ip) ?? null })),
    currentlyFailed: Number(field(lines, 'Currently failed')) || 0,
    totalBanned: Number(field(lines, 'Total banned')) || 0,
    ignoreIp: parseIgnoreIp(parts.get('ignoreip') ?? []),
    bantime: numberOrNull(times.get('bantime')),
    findtime: numberOrNull(times.get('findtime')),
    maxretry: numberOrNull(times.get('maxretry'))
  }
}

export function parseFail2ban(stdout: string): Fail2banFacts {
  const parts = sections(stdout)
  const os = (parts.get('os') ?? []).map((line) => line.trim())
  return {
    root: hasRoot(parts),
    installed: firstLine(parts, 'installed') === 'yes',
    running: firstLine(parts, 'running') === 'active',
    jails: parseJailList(parts.get('status') ?? []),
    sshd: parseJail(parts),
    clientIp: sshClientPart(firstLine(parts, 'session'), 0),
    osId: os[0] ?? '',
    osVersion: os[1] ?? '',
    jailFile: trackedFile(parts, 'jail')
  }
}

export const fail2banProbe: ProbeDefinition<Fail2banFacts> = {
  id: FAIL2BAN_PROBE,
  area: 'security',
  root: false,
  timeoutSeconds: 20,
  script,
  parse: parseFail2ban
}
