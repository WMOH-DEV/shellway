import { hasMarker, sectionLines, splitSections, type OutputSection } from './sections'
import type { SystemdData, SystemdUnit } from './types'

export const SYSTEMD_SCRIPT = `command -v systemctl >/dev/null 2>&1 || { echo @@missing; exit 0; }
echo @@units
systemctl list-units --type=service --all --plain --no-legend --no-pager 2>/dev/null
echo @@files
systemctl list-unit-files --type=service --no-legend --no-pager 2>/dev/null
echo "@@uptime $(cut -d' ' -f1 /proc/uptime 2>/dev/null)"
units=$(systemctl list-units --type=service --state=running,failed --plain --no-legend --no-pager 2>/dev/null | awk '{ print ($1 == "●" ? $2 : $1) }')
[ -n "$units" ] || exit 0
echo "@@sample $(date +%s%N)"
systemctl show -p Id,Type,TriggeredBy,MemoryCurrent,CPUUsageNSec,ActiveEnterTimestampMonotonic,InactiveEnterTimestampMonotonic $units 2>/dev/null
sleep 1
echo "@@sample $(date +%s%N)"
systemctl show -p Id,CPUUsageNSec $units 2>/dev/null
`

const ALLOW = /^(nginx|apache2|httpd|caddy|lsws|openlitespeed|php[\d.]*-fpm|mysql|mysqld|mariadb|postgresql.*|redis.*|valkey.*|keydb.*|memcached|mongod|elasticsearch|opensearch|meilisearch|typesense.*|rabbitmq-server|beanstalkd|supervisor|supervisord|docker|containerd|ssh|sshd|cron|crond|fail2ban|ufw|certbot|snap\.certbot\..*|pm2-.*|varnish|haproxy|minio|gitea|grafana-server|prometheus.*|soketi|horizon|laravel-.*|reverb.*)$/

const DENY = /^(systemd-|getty@|serial-getty@|autovt@|container-getty@|user@|user-runtime-dir@|dbus|polkit|udisks2|modprobe@|plymouth|apport|dmesg|e2scrub|fstrim|grub|keyboard-setup|kmod|lvm2|multipathd|networkd-dispatcher|open-iscsi|iscsid|pollinate|secureboot|setvtrgb|snapd|ubuntu-|ua-|apt-daily|motd-news|man-db|logrotate|dpkg-db-backup|sysstat|cloud-|finalrd|lxd-agent|thermald|upower|wpa_supplicant|ModemManager|accounts-daemon|rescue|emergency|initrd-|debug-shell|quotaon|rc-local|blk-availability|mdmonitor|mdcheck|console-|hwclock|cryptdisks|ifupdown|networking|packagekit|qemu-guest-agent|open-vm-tools|vgauth|chrony|ntp|rsyslog|irqbalance|unattended-upgrades|atd|udev|esm-cache|landscape|gpu-manager|hv-|walinuxagent|google-|amazon-ssm|snap\.)/

const UNSET_LIMIT = 2 ** 60

export function isUsefulUnit(unit: Pick<SystemdUnit, 'name' | 'active' | 'sub'>): boolean {
  if (unit.active === 'failed') return true
  if (ALLOW.test(unit.name)) return true
  return unit.sub === 'running' && !DENY.test(unit.name)
}

const stripService = (name: string): string => name.replace(/\.service$/, '')

function parseUnitLine(line: string): SystemdUnit | null {
  const tokens = line.trim().replace(/^●\s*/, '').split(/\s+/)
  if (tokens.length < 4 || !tokens[0].endsWith('.service')) return null
  const [unit, load, active, sub, ...description] = tokens
  return { name: stripService(unit), description: description.join(' '), load, active, sub, enabled: null, cpuPercent: null, memoryBytes: null, sinceSeconds: null }
}

function enabledState(state: string): boolean | null {
  if (state === 'enabled' || state === 'enabled-runtime') return true
  if (state === 'disabled' || state === 'masked') return false
  return null
}

function parseUnitFiles(lines: string[]): Map<string, boolean | null> {
  const states = new Map<string, boolean | null>()
  for (const line of lines) {
    const [unit, state] = line.trim().split(/\s+/)
    if (unit?.endsWith('.service') && !unit.includes('@.')) states.set(stripService(unit), enabledState(state ?? ''))
  }
  return states
}

type ShowRecord = Record<string, string>

function parseShowRecords(lines: string[]): Map<string, ShowRecord> {
  const records = new Map<string, ShowRecord>()
  let current: ShowRecord = {}
  const finish = () => {
    if (current.Id) records.set(stripService(current.Id), current)
    current = {}
  }
  for (const line of lines) {
    const index = line.indexOf('=')
    if (line.trim() === '') finish()
    else if (index > 0) current[line.slice(0, index)] = line.slice(index + 1).trim()
  }
  finish()
  return records
}

const numberOrNull = (value: string | undefined): number | null => {
  if (value === undefined || !/^\d+(\.\d+)?$/.test(value)) return null
  return Number(value)
}

interface Sample {
  atNs: number | null
  records: Map<string, ShowRecord>
}

function samples(sections: OutputSection[]): Sample[] {
  return sections
    .filter((section) => section.marker === 'sample')
    .map((section) => ({ atNs: numberOrNull(section.arg), records: parseShowRecords(section.lines) }))
}

function cpuPercent(name: string, [first, second]: Sample[]): number | null {
  const before = numberOrNull(first?.records.get(name)?.CPUUsageNSec)
  const after = numberOrNull(second?.records.get(name)?.CPUUsageNSec)
  if (before === null || after === null) return null
  const elapsed = first.atNs !== null && second.atNs !== null && second.atNs > first.atNs ? second.atNs - first.atNs : 1e9
  return Math.max(0, Math.round(((after - before) / elapsed) * 1000) / 10)
}

function memoryBytes(record: ShowRecord | undefined): number | null {
  const value = numberOrNull(record?.MemoryCurrent)
  return value === null || value >= UNSET_LIMIT ? null : value
}

function sinceSeconds(unit: SystemdUnit, record: ShowRecord | undefined, uptime: number | null): number | null {
  const key = unit.active === 'failed' ? 'InactiveEnterTimestampMonotonic' : 'ActiveEnterTimestampMonotonic'
  const monotonicUs = numberOrNull(record?.[key])
  if (uptime === null || !monotonicUs) return null
  return Math.max(0, Math.round(uptime - monotonicUs / 1e6))
}

const runsOnce = (unit: SystemdUnit, record: ShowRecord | undefined): boolean => record?.Type === 'oneshot' && !record.TriggeredBy && !ALLOW.test(unit.name)

function withUsage(unit: SystemdUnit, sampled: Sample[], uptime: number | null): SystemdUnit {
  const record = sampled[0]?.records.get(unit.name)
  return { ...unit, cpuPercent: unit.sub === 'running' ? cpuPercent(unit.name, sampled) : null, memoryBytes: unit.sub === 'running' ? memoryBytes(record) : null, sinceSeconds: sinceSeconds(unit, record, uptime), runsOnce: runsOnce(unit, record) }
}

function installedButNotLoaded(states: Map<string, boolean | null>, loaded: Set<string>): SystemdUnit[] {
  return [...states.entries()]
    .filter(([name, enabled]) => enabled !== null && !loaded.has(name))
    .map(([name]) => ({ name, description: '', load: 'loaded', active: 'inactive', sub: 'dead', enabled: null, cpuPercent: null, memoryBytes: null, sinceSeconds: null }))
}

export function parseSystemd(stdout: string): SystemdData {
  const sections = splitSections(stdout)
  if (hasMarker(sections, 'missing')) return { installed: false }
  const listed = sectionLines(sections, 'units').map(parseUnitLine).filter((unit): unit is SystemdUnit => unit !== null && unit.load !== 'not-found')
  const states = parseUnitFiles(sectionLines(sections, 'files'))
  const uptime = numberOrNull(sections.find((section) => section.marker === 'uptime')?.arg)
  const sampled = samples(sections)
  const all = [...listed, ...installedButNotLoaded(states, new Set(listed.map((unit) => unit.name)))]
  const units = all
    .filter(isUsefulUnit)
    .map((unit) => withUsage({ ...unit, enabled: states.get(unit.name) ?? null }, sampled, uptime))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { installed: true, units }
}
