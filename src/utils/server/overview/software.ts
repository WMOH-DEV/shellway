import type { ServerFacts } from '@/types/server/core'
import { CATALOG, ownsPackage } from '@/utils/server/software/catalog'
import { PACKAGES_PROBE, PHP_PROBE, type PackagesFacts, type PhpFacts } from '@/utils/server/software/types'

export interface SoftwareChip {
  label: string
  update: boolean
}

const shortVersion = (version: string): string => /^(?:\d+:)?(\d+(?:\.\d+)?)/.exec(version)?.[1] ?? version

function okData<T>(facts: ServerFacts, id: string): T | null {
  const result = facts[id]
  return result?.status === 'ok' ? (result.data as T) : null
}

function packageChips(packages: PackagesFacts): SoftwareChip[] {
  return CATALOG.flatMap((entry) => {
    const installed = packages.installed.find((item) => ownsPackage(entry, item.name))
    if (!installed || entry.id === 'base') return []
    const update = installed.candidate !== null && installed.candidate !== installed.version
    return [{ label: `${entry.name} ${shortVersion(installed.version)}${update ? ' ↑' : ''}`, update }]
  })
}

function extraChips(packages: PackagesFacts | null, php: PhpFacts | null): SoftwareChip[] {
  const chips: SoftwareChip[] = (php?.versions ?? []).map((version) => ({ label: `PHP ${version.version}`, update: false }))
  if (packages?.composerVersion) chips.push({ label: `Composer ${shortVersion(packages.composerVersion)}`, update: false })
  if (packages?.node.version && !packages.installed.some((item) => item.name === 'nodejs')) chips.push({ label: `Node.js ${shortVersion(packages.node.version)}`, update: false })
  if (packages?.node.pm2Version) chips.push({ label: `pm2 ${shortVersion(packages.node.pm2Version)}`, update: false })
  return chips
}

export function softwareChips(facts: ServerFacts): SoftwareChip[] {
  const packages = okData<PackagesFacts>(facts, PACKAGES_PROBE)
  const php = okData<PhpFacts>(facts, PHP_PROBE)
  return [...(packages ? packageChips(packages) : []), ...extraChips(packages, php)]
}
