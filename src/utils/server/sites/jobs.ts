import type { ServerFacts } from '../../../types/server/core'

export interface SiteJob {
  name: string
  command: string
  state: string
}

type Item = Record<string, unknown>

const isItem = (value: unknown): value is Item => typeof value === 'object' && value !== null && !Array.isArray(value)

function listsIn(data: unknown): Item[] {
  if (Array.isArray(data)) return data.filter(isItem)
  if (!isItem(data)) return []
  return Object.values(data).flatMap((value) => (Array.isArray(value) ? value.filter(isItem) : []))
}

const text = (item: Item, keys: string[]): string => {
  const found = keys.map((key) => item[key]).find((value) => typeof value === 'string' && value !== '')
  return typeof found === 'string' ? found : ''
}

function mentionsPath(item: Item, path: string): string | null {
  const base = path.replace(/\/+$/, '')
  const match = Object.values(item).find((value) => typeof value === 'string' && (value === base || value.includes(`${base}/`) || value.includes(`${base} `) || value.endsWith(base)))
  return typeof match === 'string' ? match : null
}

export function siteJobs(facts: ServerFacts, sitePath: string): SiteJob[] {
  if (sitePath.replace(/\/+$/, '') === '') return []
  return Object.entries(facts)
    .filter(([id, result]) => id.startsWith('jobs.') && result.status === 'ok')
    .flatMap(([, result]) => (result.status === 'ok' ? listsIn(result.data) : []))
    .flatMap((item) => {
      const mention = mentionsPath(item, sitePath)
      if (mention === null) return []
      return [{ name: text(item, ['name', 'program', 'id', 'schedule']), command: text(item, ['command']) || mention, state: text(item, ['state', 'status']) }]
    })
}
