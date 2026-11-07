import type { OsInfo, ServerIdentity } from '@/types/server/identity'

const GIB = 1024 ** 3
const MIB = 1024 ** 2

export function osLabel(os: OsInfo): string {
  if (!os.id) return os.prettyName
  return `${os.id.charAt(0).toUpperCase()}${os.id.slice(1)} ${os.versionId}`.trim()
}

export function memoryLabel(bytes: number): string {
  if (bytes >= GIB) return `${Math.round(bytes / GIB)} GB`
  return `${Math.round(bytes / MIB)} MB`
}

export function uptimeLabel(seconds: number): string {
  if (seconds >= 86400) return `up ${Math.floor(seconds / 86400)} d`
  if (seconds >= 3600) return `up ${Math.floor(seconds / 3600)} h`
  return `up ${Math.max(1, Math.floor(seconds / 60))} min`
}

export function sizeLine(identity: ServerIdentity): string {
  return [osLabel(identity.os), `${identity.cpus} vCPU`, memoryLabel(identity.memoryBytes)].join(' · ')
}

export function addressLine(identity: ServerIdentity): string {
  return [identity.primaryIp, uptimeLabel(identity.uptimeSeconds)].filter(Boolean).join(' · ')
}
