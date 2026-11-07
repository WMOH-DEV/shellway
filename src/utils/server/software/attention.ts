import type { AttentionItem, ServerFacts } from '@/types/server/core'
import { okData } from './planKit'
import { UPDATES_PROBE, USAGE_PROBE, type UpdatesFacts, type UsageFacts } from './types'
import { securityUpdates } from './updates'

const SOFTWARE = { section: 'software' } as const

const nameList = (names: string[], limit = 3): string => (names.length > limit ? `${names.slice(0, limit).join(', ')} and ${names.length - limit} more` : names.join(', '))

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

function updateItems(updates: UpdatesFacts): AttentionItem[] {
  const items: AttentionItem[] = []
  const security = securityUpdates(updates)
  const others = updates.packages.length - security.length
  if (security.length > 0) {
    items.push({ id: 'software.security-updates', area: 'software', level: 'warning', rank: 70, title: plural(security.length, 'security update'), detail: nameList(security.map((item) => item.name)), actionLabel: 'Review', route: SOFTWARE })
  }
  if (updates.rebootRequired) {
    const detail = updates.rebootPackages.length > 0 ? `Needed by ${nameList(updates.rebootPackages)}` : 'Installed updates need a reboot'
    items.push({ id: 'software.reboot', area: 'software', level: 'warning', rank: 60, title: 'Reboot needed', detail, actionLabel: 'Review', route: SOFTWARE })
  }
  if (others > 0) {
    items.push({ id: 'software.updates', area: 'software', level: 'info', rank: 20, title: plural(others, 'update'), detail: 'Regular package updates are ready', actionLabel: 'Review', route: SOFTWARE })
  }
  return items
}

function pressureItems(usage: UsageFacts): AttentionItem[] {
  return usage.fpmPressure
    .filter((entry) => entry.hits > 0)
    .map((entry) => ({
      id: `software.fpm-pressure.${entry.version}`,
      area: 'software',
      level: 'warning',
      rank: 65,
      title: `PHP ${entry.version} ran out of workers`,
      detail: `Reached pm.max_children ${plural(entry.hits, 'time')}${entry.last ? `, last at ${entry.last}` : ''}`,
      actionLabel: 'Tune pool',
      route: { section: 'software', sub: 'php', params: { version: entry.version } }
    }))
}

export function softwareAttention(facts: ServerFacts): AttentionItem[] {
  const updates = okData<UpdatesFacts>(facts, UPDATES_PROBE)
  const usage = okData<UsageFacts>(facts, USAGE_PROBE)
  return [...(updates?.supported ? updateItems(updates) : []), ...(usage ? pressureItems(usage) : [])]
}
