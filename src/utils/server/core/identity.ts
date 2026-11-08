import type { ProbeDefinition } from '@/types/server/core'
import { IDENTITY_PROBE, type OsFamily, type OsInfo, type ServerIdentity } from '@/types/server/identity'

const MARK = '@@'

export const IDENTITY_SCRIPT = `PATH="$PATH:/usr/sbin:/sbin"; export PATH
section() { printf '${MARK}%s\\n' "$1"; }
section os; cat /etc/os-release 2>/dev/null
section hostname; uname -n
section kernel; uname -r
section arch; uname -m
section virt; systemd-detect-virt 2>/dev/null
section cpus; nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null
section memory; grep '^MemTotal:' /proc/meminfo 2>/dev/null
section uptime; cat /proc/uptime 2>/dev/null
section route; ip route get 1.1.1.1 2>/dev/null
section addresses; hostname -I 2>/dev/null
section ssh; printf '%s\\n' "$SSH_CONNECTION"
section user; id -un
section timezone; timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || readlink /etc/localtime 2>/dev/null
exit 0
`

export function parseSections(stdout: string): Map<string, string> {
  const sections = new Map<string, string[]>()
  let current: string[] | null = null
  for (const line of stdout.split('\n')) {
    if (line.startsWith(MARK)) {
      current = []
      sections.set(line.slice(MARK.length).trim(), current)
    } else current?.push(line)
  }
  return new Map([...sections].map(([name, lines]) => [name, lines.join('\n').trim()]))
}

export function parseOsRelease(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2')
  }
  return values
}

const RHEL_LIKE = ['rhel', 'centos', 'fedora', 'rocky', 'almalinux', 'ol']

function osFamily(id: string, like: string[]): OsFamily {
  const ids = [id, ...like]
  if (ids.includes('ubuntu')) return 'ubuntu'
  if (ids.includes('debian')) return 'debian'
  return ids.some((name) => RHEL_LIKE.includes(name)) ? 'rhel' : 'other'
}

export function osInfo(text: string): OsInfo {
  const values = parseOsRelease(text)
  const id = (values.ID ?? '').toLowerCase()
  const family = osFamily(id, (values.ID_LIKE ?? '').toLowerCase().split(/\s+/).filter(Boolean))
  const codename = (family === 'ubuntu' ? values.UBUNTU_CODENAME : '') || values.VERSION_CODENAME || ''
  return { family, id, versionId: values.VERSION_ID ?? '', codename, prettyName: values.PRETTY_NAME || id || 'Unknown' }
}

const firstLine = (text: string | undefined): string => (text ?? '').split('\n')[0].trim()

function wholeNumber(text: string | undefined): number {
  const value = Number.parseInt(firstLine(text), 10)
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function memoryBytes(text: string | undefined): number {
  const kb = /MemTotal:\s*(\d+)\s*kB/i.exec(text ?? '')
  return kb ? Number(kb[1]) * 1024 : 0
}

function primaryIp(route: string | undefined, addresses: string | undefined): string {
  const viaRoute = /\bsrc\s+(\S+)/.exec(route ?? '')
  return viaRoute?.[1] ?? firstLine(addresses).split(/\s+/)[0]
}

function sshPort(connection: string | undefined): number {
  const port = Number(firstLine(connection).split(/\s+/)[3])
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 0
}

function timezone(text: string | undefined): string {
  const value = firstLine(text)
  const marker = 'zoneinfo/'
  const at = value.indexOf(marker)
  return at >= 0 ? value.slice(at + marker.length) : value
}

export function parseIdentity(stdout: string): ServerIdentity {
  const s = parseSections(stdout)
  return {
    hostname: firstLine(s.get('hostname')),
    os: osInfo(s.get('os') ?? ''),
    kernel: firstLine(s.get('kernel')),
    arch: firstLine(s.get('arch')),
    virtualization: firstLine(s.get('virt')),
    cpus: wholeNumber(s.get('cpus')),
    memoryBytes: memoryBytes(s.get('memory')),
    uptimeSeconds: Math.floor(Number.parseFloat(firstLine(s.get('uptime'))) || 0),
    primaryIp: primaryIp(s.get('route'), s.get('addresses')),
    sshPort: sshPort(s.get('ssh')),
    user: firstLine(s.get('user')),
    timezone: timezone(s.get('timezone'))
  }
}

export const identityProbe: ProbeDefinition<ServerIdentity> = {
  id: IDENTITY_PROBE,
  area: 'core',
  root: false,
  timeoutSeconds: 15,
  script: IDENTITY_SCRIPT,
  parse: parseIdentity
}
