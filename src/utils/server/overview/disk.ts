import type { AttentionItem, ProbeDefinition, ServerFacts } from '@/types/server/core'
import { formatUsage } from './format'
import { DISK_PROBE, DISK_ROUTE } from './ids'

export interface Filesystem {
  device: string
  type: string
  sizeBytes: number
  usedBytes: number
  availBytes: number
  usedPercent: number
  mount: string
}

const VIRTUAL_TYPES: ReadonlySet<string> = new Set(['tmpfs', 'devtmpfs', 'overlay', 'squashfs', 'efivarfs', 'ramfs', 'nsfs', 'proc', 'sysfs'])

const DISK_SCRIPT = [
  'export LC_ALL=C',
  'df -PTk -x tmpfs -x devtmpfs -x overlay -x squashfs -x efivarfs 2>/dev/null',
  'exit 0',
  ''
].join('\n')

function parseLine(line: string): Filesystem | null {
  const fields = line.trim().split(/\s+/)
  if (fields.length < 7) return null
  const [device, type, size, used, avail, capacity] = fields
  const sizeBytes = Number(size) * 1024
  const usedPercent = Number(capacity.replace('%', ''))
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || !Number.isFinite(usedPercent)) return null
  return { device, type, sizeBytes, usedBytes: Number(used) * 1024, availBytes: Number(avail) * 1024, usedPercent, mount: fields.slice(6).join(' ') }
}

function keepShortestMountPerDevice(filesystems: Filesystem[]): Filesystem[] {
  const byDevice = new Map<string, Filesystem>()
  for (const fs of filesystems) {
    const kept = byDevice.get(fs.device)
    if (!kept || fs.mount.length < kept.mount.length) byDevice.set(fs.device, fs)
  }
  return [...byDevice.values()]
}

export function parseDisk(stdout: string): Filesystem[] {
  const parsed = stdout.split('\n').slice(1).map(parseLine).filter((fs): fs is Filesystem => fs !== null && !VIRTUAL_TYPES.has(fs.type))
  return keepShortestMountPerDevice(parsed).sort((a, b) => a.mount.localeCompare(b.mount))
}

export const diskProbe: ProbeDefinition<Filesystem[]> = {
  id: DISK_PROBE,
  area: 'overview',
  root: false,
  timeoutSeconds: 15,
  script: DISK_SCRIPT,
  parse: parseDisk
}

export const rootFilesystem = (filesystems: Filesystem[]): Filesystem | null => filesystems.find((fs) => fs.mount === '/') ?? null

export const DISK_ERROR_PERCENT = 90
export const DISK_WARNING_PERCENT = 80

function diskItem(fs: Filesystem): AttentionItem {
  const isError = fs.usedPercent >= DISK_ERROR_PERCENT
  const where = fs.mount === '/' ? 'Disk' : `Disk ${fs.mount}`
  return {
    id: `overview.disk:${fs.mount}`,
    area: 'overview',
    level: isError ? 'error' : 'warning',
    rank: (isError ? 140 : 70) + Math.min(9, fs.usedPercent - (isError ? DISK_ERROR_PERCENT : DISK_WARNING_PERCENT)),
    title: `${where} ${fs.usedPercent}% full`,
    detail: `${formatUsage(fs.usedBytes, fs.sizeBytes)} used on ${fs.mount}`,
    actionLabel: 'Clean up',
    route: DISK_ROUTE
  }
}

export function diskAttention(facts: ServerFacts): AttentionItem[] {
  const result = facts[DISK_PROBE]
  if (result?.status !== 'ok') return []
  return (result.data as Filesystem[]).filter((fs) => fs.usedPercent >= DISK_WARNING_PERCENT).map(diskItem)
}
