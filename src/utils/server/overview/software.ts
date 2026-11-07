import type { ServerFacts } from '@/types/server/core'

export interface SoftwareChip {
  label: string
  update: boolean
}

interface InstalledComponent {
  name: string
  version: string
  updateAvailable?: boolean
  candidate?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isInstalledComponent = (value: unknown): value is InstalledComponent =>
  isRecord(value) && typeof value.name === 'string' && typeof value.version === 'string' && value.version !== ''

function componentList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (isRecord(data) && Array.isArray(data.components)) return data.components
  return []
}

const shortVersion = (version: string): string => /^\d+(\.\d+)?/.exec(version)?.[0] ?? version

const hasUpdate = (component: InstalledComponent): boolean =>
  component.updateAvailable === true || (typeof component.candidate === 'string' && component.candidate !== '' && component.candidate !== component.version)

function toChip(component: InstalledComponent): SoftwareChip {
  const update = hasUpdate(component)
  return { label: `${component.name} ${shortVersion(component.version)}${update ? ' ↑' : ''}`, update }
}

export function softwareChips(facts: ServerFacts): SoftwareChip[] {
  const chips = Object.entries(facts)
    .filter(([id, result]) => id.startsWith('software.') && result.status === 'ok')
    .flatMap(([, result]) => componentList(result.status === 'ok' ? result.data : null))
    .filter(isInstalledComponent)
    .map(toChip)
  return [...new Map(chips.map((chip) => [chip.label, chip])).values()]
}
