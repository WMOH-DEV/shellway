import type { SystemState } from './system'

export const FRESH_INSTALL_DAYS = 30

export interface FreshInput {
  system: SystemState | null
  siteCount: number | null
}

const DAY_SECONDS = 86400

const isRecentInstall = ({ installedAt, now }: SystemState): boolean =>
  installedAt !== null && now !== null && now - installedAt <= FRESH_INSTALL_DAYS * DAY_SECONDS

export function isFreshServer({ system, siteCount }: FreshInput): boolean {
  if (!system || siteCount === null) return false
  return system.webServers.length === 0 && siteCount === 0 && isRecentInstall(system)
}
