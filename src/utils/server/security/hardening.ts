import type { ProbeDefinition } from '@/types/server/core'
import { fileWithSha, firstLine, keyValues, sections, trackedFile, type TrackedFile } from './shell'

export const HARDENING_PROBE = 'security.hardening'
export const TIMEZONES_PROBE = 'security.timezones'
export const AUTO_UPGRADES_FILE = '/etc/apt/apt.conf.d/20auto-upgrades'
export const SWAP_FILE = '/swapfile'

export interface SwapDevice {
  name: string
  type: string
  sizeBytes: number
}

export interface HardeningFacts {
  unattendedInstalled: boolean
  unattendedEnabled: boolean
  updateListsEnabled: boolean
  autoUpgradesFile: TrackedFile | null
  rebootRequired: boolean
  rebootPackages: string[]
  swaps: SwapDevice[]
  memoryBytes: number
  swappiness: number | null
  rootFreeBytes: number | null
  fstab: TrackedFile | null
  ntpEnabled: boolean
  ntpSynchronized: boolean
  canNtp: boolean
  timezone: string
  hostname: string
  hosts: TrackedFile | null
}

const script = [
  'echo "@@unattended"; dpkg-query -W -f="\\${Status}\\n" unattended-upgrades 2>/dev/null',
  'echo "@@periodic"; apt-config dump 2>/dev/null | grep -E "^APT::Periodic::(Unattended-Upgrade|Update-Package-Lists) "',
  fileWithSha('autoupgrades', AUTO_UPGRADES_FILE, false),
  'echo "@@reboot"; if [ -f /var/run/reboot-required ]; then echo yes; else echo no; fi',
  'echo "@@rebootpkgs"; cat /var/run/reboot-required.pkgs 2>/dev/null',
  'echo "@@swaps"; swapon --show=NAME,TYPE,SIZE --bytes --noheadings 2>/dev/null',
  'echo "@@meminfo"; grep -E "^MemTotal:" /proc/meminfo',
  'echo "@@swappiness"; cat /proc/sys/vm/swappiness 2>/dev/null',
  'echo "@@rootfree"; df -B1 --output=avail / 2>/dev/null | tail -n 1',
  fileWithSha('fstab', '/etc/fstab', false),
  'echo "@@time"; timedatectl show 2>/dev/null',
  'echo "@@hostname"; hostname',
  fileWithSha('hosts', '/etc/hosts', false)
].join('\n')

export function parsePeriodic(lines: string[]): { unattended: boolean; updateLists: boolean } {
  const value = (name: string) => lines.find((line) => line.startsWith(`APT::Periodic::${name} `))?.match(/"([^"]*)"/)?.[1] ?? '0'
  const on = (raw: string) => raw !== '0' && raw !== '' && raw.toLowerCase() !== 'false'
  return { unattended: on(value('Unattended-Upgrade')), updateLists: on(value('Update-Package-Lists')) }
}

export function parseSwaps(lines: string[]): SwapDevice[] {
  return lines.map((line) => line.trim().split(/\s+/)).filter((cols) => cols.length >= 3 && cols[0]).map(([name, type, size]) => ({ name, type, sizeBytes: Number(size) || 0 }))
}

export function parseHardening(stdout: string): HardeningFacts {
  const parts = sections(stdout)
  const periodic = parsePeriodic(parts.get('periodic') ?? [])
  const time = keyValues(parts.get('time') ?? [])
  const memKb = Number(/(\d+)/.exec(firstLine(parts, 'meminfo'))?.[1] ?? 0)
  const swappiness = Number(firstLine(parts, 'swappiness'))
  const free = Number(firstLine(parts, 'rootfree'))
  return {
    unattendedInstalled: firstLine(parts, 'unattended').includes('install ok installed'),
    unattendedEnabled: periodic.unattended,
    updateListsEnabled: periodic.updateLists,
    autoUpgradesFile: trackedFile(parts, 'autoupgrades'),
    rebootRequired: firstLine(parts, 'reboot') === 'yes',
    rebootPackages: (parts.get('rebootpkgs') ?? []).map((line) => line.trim()).filter(Boolean),
    swaps: parseSwaps(parts.get('swaps') ?? []),
    memoryBytes: memKb * 1024,
    swappiness: firstLine(parts, 'swappiness') !== '' && Number.isFinite(swappiness) ? swappiness : null,
    rootFreeBytes: firstLine(parts, 'rootfree') !== '' && Number.isFinite(free) ? free : null,
    fstab: trackedFile(parts, 'fstab'),
    ntpEnabled: time.get('NTP') === 'yes',
    ntpSynchronized: time.get('NTPSynchronized') === 'yes',
    canNtp: time.get('CanNTP') === 'yes',
    timezone: time.get('Timezone') ?? '',
    hostname: firstLine(parts, 'hostname'),
    hosts: trackedFile(parts, 'hosts')
  }
}

export const hardeningProbe: ProbeDefinition<HardeningFacts> = {
  id: HARDENING_PROBE,
  area: 'security',
  root: false,
  timeoutSeconds: 15,
  script,
  parse: parseHardening
}

export const parseTimezones = (stdout: string): string[] => stdout.split('\n').map((line) => line.trim()).filter((line) => /^[A-Za-z0-9_+\-/]+$/.test(line))

export const timezonesProbe: ProbeDefinition<string[]> = {
  id: TIMEZONES_PROBE,
  area: 'security',
  root: false,
  timeoutSeconds: 10,
  script: 'timedatectl list-timezones 2>/dev/null',
  parse: parseTimezones
}
