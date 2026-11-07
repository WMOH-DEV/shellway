import type { ServerFacts } from '@/types/server/core'
import { INVENTORY_PROBE } from './inventory'
import type { SetupInventory } from './types'

const RECENT_SECONDS = 30 * 24 * 60 * 60

const WEB_SERVERS = ['nginx', 'apache2']

export function inventoryFrom(facts: ServerFacts): SetupInventory | null {
  const result = facts[INVENTORY_PROBE]
  return result?.status === 'ok' ? (result.data as SetupInventory) : null
}

const isRecentInstall = (installedAt: number | null, now: number): boolean => installedAt === null || now / 1000 - installedAt < RECENT_SECONDS

export function isFreshServer(facts: ServerFacts, now: number = Date.now()): boolean {
  const inventory = inventoryFrom(facts)
  if (!inventory) return false
  if (inventory.packages.some((name) => WEB_SERVERS.includes(name))) return false
  return inventory.wwwSites === 0 && isRecentInstall(inventory.installedAt, now)
}
