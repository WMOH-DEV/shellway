import type { CloudflareStatus, PermissionGroup, PermissionGroupId, PermissionState } from '../../types/ssl'

export const PERMISSION_LABELS = {
  zone: 'Zone → Zone → Read',
  dns: 'Zone → DNS → Read',
  zoneSettingsRead: 'Zone → Zone Settings → Read',
  sslEdit: 'Zone → SSL and Certificates → Edit',
  zoneSettingsEdit: 'Zone → Zone Settings → Edit',
  dnsEdit: 'Zone → DNS → Edit'
} as const

export interface PermissionGroupMeta {
  id: PermissionGroupId
  title: string
  sub: string
  labels: string[]
}

export const PERMISSION_GROUP_META: PermissionGroupMeta[] = [
  { id: 'monitoring', title: 'Monitoring', sub: 'read only', labels: [PERMISSION_LABELS.zone, PERMISSION_LABELS.dns, PERMISSION_LABELS.zoneSettingsRead] },
  { id: 'origin-ca', title: 'Switch to Origin CA', sub: 'optional, issues certificates', labels: [PERMISSION_LABELS.sslEdit] },
  { id: 'zone-mode', title: 'Change zone SSL mode', sub: 'optional', labels: [PERMISSION_LABELS.zoneSettingsEdit] },
  { id: 'dns-records', title: 'Create DNS records', sub: 'optional, used by Create site', labels: [PERMISSION_LABELS.dnsEdit] }
]

const MISSING_TEXT: Record<string, string> = {
  [PERMISSION_LABELS.zone]: 'Without it Shellway cannot see which of your domains are on Cloudflare.',
  [PERMISSION_LABELS.dns]: 'Without it Shellway cannot tell whether a hostname goes through Cloudflare or points to another server.',
  [PERMISSION_LABELS.zoneSettingsRead]: 'Without it Shellway cannot read the zone SSL mode, so it cannot tell whether Cloudflare checks your server certificate.',
  [PERMISSION_LABELS.sslEdit]: 'Needed only to switch a hostname to a Cloudflare Origin CA certificate. Monitoring works without it.',
  [PERMISSION_LABELS.zoneSettingsEdit]: 'Needed only to change a zone SSL mode from Shellway. Monitoring works without it.',
  [PERMISSION_LABELS.dnsEdit]: 'Needed only for Create site to add the new site\'s DNS record. Monitoring works without it.'
}

const UNCHECKED_TEXT = 'Cannot be checked without changing something on Cloudflare. Shellway checks it the first time it is used.'

export type LineMark = 'granted' | 'missing' | 'unchecked'
export type ChipTone = 'success' | 'warning' | 'error' | 'neutral'

export interface TokenChip {
  text: string
  tone: ChipTone
}

const CHIP_TEXT: Record<PermissionState, string> = {
  granted: 'granted',
  missing: 'missing',
  'not-granted': 'not granted',
  unknown: 'not checked'
}

const CHIP_TONE: Record<PermissionState, ChipTone> = {
  granted: 'success',
  missing: 'error',
  'not-granted': 'neutral',
  unknown: 'neutral'
}

export function placeholderGroups(): PermissionGroup[] {
  return PERMISSION_GROUP_META.map(({ id, labels }) => ({
    id,
    state: 'unknown',
    lines: labels.map((label) => ({ label, state: 'unknown' }))
  }))
}

export function lineMark(state: PermissionState): LineMark {
  if (state === 'granted') return 'granted'
  return state === 'missing' ? 'missing' : 'unchecked'
}

export const groupChipText = (state: PermissionState): string => CHIP_TEXT[state]

export const groupChipTone = (state: PermissionState): ChipTone => CHIP_TONE[state]

export function permissionExplanation(label: string, state: PermissionState): string | null {
  if (state === 'granted') return null
  if (state === 'unknown') return UNCHECKED_TEXT
  return MISSING_TEXT[label] ?? null
}

export function groupMeta(id: PermissionGroupId): PermissionGroupMeta {
  return PERMISSION_GROUP_META.find((meta) => meta.id === id) ?? PERMISSION_GROUP_META[0]
}

export function tokenChip(status: CloudflareStatus): TokenChip {
  if (!status.saved) return { text: 'not connected', tone: 'neutral' }
  if (status.error) return { text: 'needs attention', tone: 'error' }
  const monitoring = status.permissions.find((group) => group.id === 'monitoring')
  if (monitoring?.state === 'missing') return { text: 'missing permissions', tone: 'warning' }
  return { text: 'connected', tone: 'success' }
}
