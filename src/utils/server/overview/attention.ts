import type { AttentionItem, AttentionLevel } from '@/types/server/core'

const LEVEL_ORDER: Record<AttentionLevel, number> = { error: 0, warning: 1, info: 2 }

const compare = (a: AttentionItem, b: AttentionItem): number =>
  b.rank - a.rank || LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.title.localeCompare(b.title)

export function rankAttention(items: AttentionItem[]): AttentionItem[] {
  const unique = new Map(items.map((item) => [item.id, item]))
  return [...unique.values()].sort(compare)
}

export function worstLevel(items: readonly AttentionItem[]): AttentionLevel | null {
  return items.reduce<AttentionLevel | null>((worst, item) => (worst === null || LEVEL_ORDER[item.level] < LEVEL_ORDER[worst] ? item.level : worst), null)
}
