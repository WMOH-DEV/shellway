import { describe, expect, it } from 'vitest'
import type { CloudflareStatus } from '../../types/ssl'
import { groupChipText, groupChipTone, lineMark, PERMISSION_GROUP_META, PERMISSION_LABELS, permissionExplanation, placeholderGroups, tokenChip } from './settingsPermissions'
import { cloudflareTokenUrl } from './settingsToken'

describe('permission summaries', () => {
  it('words and tones every state', () => {
    expect(groupChipText('granted')).toBe('granted')
    expect(groupChipText('not-granted')).toBe('not granted')
    expect(groupChipTone('missing')).toBe('error')
    expect(groupChipTone('unknown')).toBe('neutral')
  })

  it('maps line states to marks', () => {
    expect(lineMark('granted')).toBe('granted')
    expect(lineMark('missing')).toBe('missing')
    expect(lineMark('not-granted')).toBe('unchecked')
    expect(lineMark('unknown')).toBe('unchecked')
  })

  it('keeps the exact labels the Cloudflare client reports', () => {
    expect(PERMISSION_LABELS).toEqual({
      zone: 'Zone → Zone → Read',
      dns: 'Zone → DNS → Read',
      zoneSettingsRead: 'Zone → Zone Settings → Read',
      sslEdit: 'Zone → SSL and Certificates → Edit',
      zoneSettingsEdit: 'Zone → Zone Settings → Edit'
    })
  })

  it('builds instruction groups from the same labels the client reports', () => {
    const groups = placeholderGroups()
    expect(groups.map((g) => g.id)).toEqual(['monitoring', 'origin-ca', 'zone-mode'])
    expect(groups[0].lines.map((l) => l.label)).toEqual(PERMISSION_GROUP_META[0].labels)
  })
})

describe('permissionExplanation', () => {
  it('says nothing for a granted permission', () => {
    expect(permissionExplanation(PERMISSION_LABELS.dns, 'granted')).toBeNull()
  })

  it('explains what a missing monitoring permission costs', () => {
    expect(permissionExplanation(PERMISSION_LABELS.dns, 'missing')).toContain('points to another server')
  })

  it('says optional permissions are not needed for monitoring', () => {
    expect(permissionExplanation(PERMISSION_LABELS.sslEdit, 'not-granted')).toContain('Monitoring works without it')
  })

  it('says unchecked permissions are checked on first use', () => {
    expect(permissionExplanation(PERMISSION_LABELS.sslEdit, 'unknown')).toContain('first time it is used')
  })

  it('has text for a label it does not know', () => {
    expect(permissionExplanation('Other', 'missing')).toBeNull()
  })
})

describe('cloudflareTokenUrl', () => {
  it('opens the profile token page with monitoring permissions pre-filled', () => {
    const url = new URL(cloudflareTokenUrl())
    expect(url.origin + url.pathname).toBe('https://dash.cloudflare.com/profile/api-tokens')
    expect(JSON.parse(url.searchParams.get('permissionGroupKeys') ?? '[]')).toEqual([
      { key: 'zone', type: 'read' },
      { key: 'dns', type: 'read' },
      { key: 'zone_settings', type: 'read' }
    ])
    expect(url.searchParams.get('zoneId')).toBe('all')
  })
})

describe('tokenChip', () => {
  const saved = (overrides: Partial<CloudflareStatus> = {}): CloudflareStatus => ({ saved: true, tokenHint: '…3f2a', error: null, permissions: placeholderGroups(), zones: [], ...overrides })

  it('is neutral without a token', () => {
    expect(tokenChip({ ...saved(), saved: false })).toEqual({ text: 'not connected', tone: 'neutral' })
  })

  it('is an error when Cloudflare rejected the token', () => {
    expect(tokenChip(saved({ error: 'Cloudflare rejected this token.' }))).toEqual({ text: 'needs attention', tone: 'error' })
  })

  it('warns when a monitoring permission is missing', () => {
    const permissions = placeholderGroups().map((g) => (g.id === 'monitoring' ? { ...g, state: 'missing' as const } : g))
    expect(tokenChip(saved({ permissions }))).toEqual({ text: 'missing permissions', tone: 'warning' })
  })

  it('is connected when monitoring is not missing, even if optional groups are not granted', () => {
    const permissions = placeholderGroups().map((g) => ({ ...g, state: g.id === 'monitoring' ? ('granted' as const) : ('not-granted' as const) }))
    expect(tokenChip(saved({ permissions }))).toEqual({ text: 'connected', tone: 'success' })
  })
})
