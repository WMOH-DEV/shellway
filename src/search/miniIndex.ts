import MiniSearch, { type Options } from 'minisearch'

const SEPARATORS = /[\n\r\p{Z}\p{P}]+/u
const CAMEL_BOUNDARY = /(?<=[a-z0-9])(?=[A-Z])/

function splitTerms(text: string): string[] {
  return text.split(SEPARATORS).filter(Boolean)
}

function indexTerms(text: string): string[] {
  return splitTerms(text).flatMap((term) => {
    const parts = term.split(CAMEL_BOUNDARY)
    return parts.length > 1 ? [term, ...parts] : [term]
  })
}

export interface Collection<T extends { id: string }> {
  index: MiniSearch<T>
  byId: Map<string, T>
}

export function createIndex<T extends { id: string }>(fields: string[], storeFields: string[] = []): MiniSearch<T> {
  const options: Options<T> = { fields, storeFields, tokenize: indexTerms, searchOptions: { tokenize: splitTerms } }
  return new MiniSearch<T>(options)
}

export function searchIndex<T extends { id: string }>(index: MiniSearch<T>, text: string, limit: number): string[] {
  if (splitTerms(text).length === 0) return []
  return index
    .search(text, { prefix: true, fuzzy: 0.2, combineWith: 'AND' })
    .slice(0, limit)
    .map((hit) => String(hit.id))
}

export function buildCollection<T extends { id: string }>(entries: T[], fields: string[]): Collection<T> {
  const index = createIndex<T>(fields)
  index.addAll(entries)
  return { index, byId: new Map(entries.map((entry) => [entry.id, entry])) }
}

export function searchCollection<T extends { id: string }>(collection: Collection<T>, text: string, limit: number): T[] {
  const found: T[] = []
  for (const id of searchIndex(collection.index, text, limit)) {
    const entry = collection.byId.get(id)
    if (entry) found.push(entry)
  }
  return found
}

interface Memo {
  deps: readonly unknown[]
  value: unknown
}

const memos = new Map<string, Memo>()

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((dep, i) => Object.is(dep, b[i]))
}

export function memoIndex<T extends { id: string }>(
  key: string,
  deps: readonly unknown[],
  build: () => Collection<T>
): Collection<T> {
  const cached = memos.get(key)
  if (cached && sameDeps(cached.deps, deps)) return cached.value as Collection<T>
  const value = build()
  memos.set(key, { deps, value })
  return value
}

export function clearMemoIndexes(): void {
  memos.clear()
}
