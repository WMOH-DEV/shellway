import type { GroupedResults } from '@/search/ranking'
import type { ProviderId, ScoredResult } from '@/search/types'

export interface Section {
  key: string
  label: string
  providerId: ProviderId | null
  overflow: number
  rows: ScoredResult[]
  start: number
}

export type ListItem =
  | { kind: 'header'; key: string; section: Section }
  | { kind: 'row'; key: string; result: ScoredResult; rowIndex: number }

export const BEST_MATCH_LABEL = 'Best match'

export function buildSections(grouped: GroupedResults): Section[] {
  const sections: Section[] = []
  let start = 0
  const add = (key: string, label: string, providerId: ProviderId | null, overflow: number, rows: ScoredResult[]) => {
    if (rows.length === 0) return
    sections.push({ key, label, providerId, overflow, rows, start })
    start += rows.length
  }
  if (grouped.best) add('best', BEST_MATCH_LABEL, null, 0, [grouped.best])
  for (const group of grouped.groups) add(group.providerId, group.label, group.providerId, group.overflow, group.results)
  return sections
}

export function sectionRows(sections: Section[]): ScoredResult[] {
  return sections.flatMap((s) => s.rows)
}

export function buildListItems(sections: Section[]): ListItem[] {
  return sections.flatMap((section) => [
    { kind: 'header' as const, key: `header:${section.key}`, section },
    ...section.rows.map((result, offset) => ({
      kind: 'row' as const,
      key: `row:${result.id}`,
      result,
      rowIndex: section.start + offset
    }))
  ])
}

export function wrapIndex(count: number, current: number, delta: number): number {
  if (count === 0) return 0
  return (current + delta + count) % count
}

export function stepGroup(sections: Section[], activeIndex: number, delta: 1 | -1): number {
  if (sections.length === 0) return 0
  const current = sections.findIndex((s) => activeIndex >= s.start && activeIndex < s.start + s.rows.length)
  const next = wrapIndex(sections.length, Math.max(0, current), delta)
  return sections[next].start
}
