import type { ProviderId, ResultGroup, ScoredResult, SearchResult } from './types'

export const MATCH = { exact: 1, prefix: 0.85, wordStart: 0.7, substring: 0.55, keyword: 0.4, fuzzy: 0.3, none: 0 } as const

export const TYPE_WEIGHTS: Record<ProviderId, number> = {
  tables: 1,
  sessions: 1,
  queries: 0.95,
  sites: 0.9,
  commands: 0.9,
  files: 0.85,
  services: 0.85,
  history: 0.8,
  snippets: 0.8,
  settings: 0.75
}

export const GROUP_LABELS: Record<ProviderId, string> = {
  tables: 'Tables',
  sessions: 'Servers',
  queries: 'Saved queries',
  sites: 'Sites',
  commands: 'Commands',
  files: 'Files',
  services: 'Services',
  history: 'History',
  snippets: 'Snippets',
  settings: 'Settings'
}

const GROUP_ORDER: ProviderId[] = ['sessions', 'tables', 'queries', 'files', 'sites', 'services', 'commands', 'snippets', 'history', 'settings']

export const WEIGHTS = { recency: 0.25, frequency: 0.15, context: 0.2, learned: 0.3, disconnectedPenalty: 0.3 } as const
export const BEST_MATCH_MARGIN = 0.1
const EMPTY_QUERY_MATCH = 0.5

export interface UsageLookup {
  recency(resultId: string): number
  frequency(resultId: string): number
  learned(queryText: string, resultId: string): number
}

export const NO_USAGE: UsageLookup = { recency: () => 0, frequency: () => 0, learned: () => 0 }

function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0
  for (const char of haystack) {
    if (char === needle[i]) i++
    if (i === needle.length) return true
  }
  return false
}

export function textMatch(title: string, queryText: string, keywords = ''): number {
  const q = queryText.trim().toLowerCase()
  if (!q) return EMPTY_QUERY_MATCH
  const t = title.toLowerCase()
  if (t === q) return MATCH.exact
  if (t.startsWith(q)) return MATCH.prefix
  if (words(title).some((w) => w.startsWith(q))) return MATCH.wordStart
  if (t.includes(q)) return MATCH.substring
  if (keywords.toLowerCase().includes(q)) return MATCH.keyword
  if (isSubsequence(q.replace(/\s+/g, ''), t)) return MATCH.fuzzy
  return MATCH.none
}

export function recencyFromTimestamp(timestamp: number | undefined, now: number): number {
  if (!timestamp) return 0
  const ageHours = Math.max(0, now - timestamp) / 3_600_000
  return 1 / (1 + ageHours / 24)
}

export function frequencyFromCount(count: number): number {
  return Math.min(1, Math.log2(1 + Math.max(0, count)) / 5)
}

export function scoreResult(result: SearchResult, queryText: string, usage: UsageLookup = NO_USAGE): number {
  const match = textMatch(result.title, queryText, result.keywords)
  if (match === MATCH.none) return 0
  const hints = result.scoreHints
  const recency = Math.max(hints.recency ?? 0, usage.recency(result.id))
  const frequency = Math.max(hints.frequency ?? 0, usage.frequency(result.id))
  return (
    match * TYPE_WEIGHTS[result.providerId] +
    WEIGHTS.recency * recency +
    WEIGHTS.frequency * frequency +
    WEIGHTS.context * (hints.context ?? 0) +
    WEIGHTS.learned * usage.learned(queryText, result.id) -
    (hints.disconnected ? WEIGHTS.disconnectedPenalty : 0)
  )
}

export function rankResults(results: SearchResult[], queryText: string, usage: UsageLookup = NO_USAGE): ScoredResult[] {
  return results
    .map((r) => ({ ...r, score: scoreResult(r, queryText, usage) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
}

export function pickBestMatch(ranked: ScoredResult[]): ScoredResult | null {
  const [first, second] = ranked
  if (!first) return null
  if (!second || first.score - second.score >= BEST_MATCH_MARGIN) return first
  return null
}

export interface GroupedResults {
  best: ScoredResult | null
  groups: ResultGroup[]
  total: number
}

export function groupResults(ranked: ScoredResult[], perGroupLimit: number, withBestMatch = true): GroupedResults {
  const best = withBestMatch ? pickBestMatch(ranked) : null
  const byProvider = new Map<ProviderId, ScoredResult[]>()
  for (const r of ranked) {
    if (r === best) continue
    const list = byProvider.get(r.providerId) ?? []
    list.push(r)
    byProvider.set(r.providerId, list)
  }
  const groups = [...byProvider.entries()]
    .sort(([a, ra], [b, rb]) => rb[0].score - ra[0].score || GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b))
    .map(([providerId, list]) => ({
      providerId,
      label: GROUP_LABELS[providerId],
      results: list.slice(0, perGroupLimit),
      overflow: Math.max(0, list.length - perGroupLimit)
    }))
  return { best, groups, total: ranked.length }
}
