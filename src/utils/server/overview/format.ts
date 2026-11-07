const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
const KIB = 1024

const unitIndex = (bytes: number): number => (bytes < KIB ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(KIB)), UNITS.length - 1))

const amount = (value: number): string => String(value < 10 ? Math.round(value * 10) / 10 : Math.round(value))

const scaled = (bytes: number, index: number): string => amount(bytes / KIB ** index)

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const index = unitIndex(bytes)
  return `${scaled(bytes, index)} ${UNITS[index]}`
}

export function formatUsage(usedBytes: number, totalBytes: number): string {
  const index = unitIndex(Math.max(totalBytes, 1))
  return `${scaled(Math.max(usedBytes, 0), index)} of ${scaled(Math.max(totalBytes, 0), index)} ${UNITS[index]}`
}

export const formatRate = (bytesPerSecond: number): string => `${formatSize(bytesPerSecond)}/s`

export function formatDownUp(down: number, up: number): string {
  const index = unitIndex(Math.max(down, up, 1))
  return `↓ ${scaled(Math.max(down, 0), index)} · ↑ ${scaled(Math.max(up, 0), index)} ${UNITS[index]}/s`
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days} d ${hours} h`
  if (hours > 0) return `${hours} h ${minutes} min`
  return `${minutes} min`
}

export const percentOf = (part: number, total: number): number => (total > 0 ? Math.min(100, Math.max(0, (part / total) * 100)) : 0)

export const keyValueLines = (stdout: string): Map<string, string> =>
  new Map(stdout.split('\n').flatMap((line) => {
    const at = line.indexOf('=')
    return at > 0 ? [[line.slice(0, at).trim(), line.slice(at + 1).trim()] as [string, string]] : []
  }))

export const toNumber = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
