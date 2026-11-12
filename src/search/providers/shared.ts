import { useConnectionStore } from '@/stores/connectionStore'
import { savedDatabaseLabel, useSavedDatabaseStore } from '@/stores/savedDatabaseStore'
import { useSessionStore } from '@/stores/sessionStore'
import type { ConnectionTab } from '@/types/session'
import type { SearchQuery, SearchResult } from '../types'

export const MAX_RESULTS = 50

export function localSearch(compute: (query: SearchQuery) => SearchResult[]) {
  return async function* (query: SearchQuery, signal: AbortSignal): AsyncGenerator<SearchResult[]> {
    if (signal.aborted) return
    const results = compute(query).slice(0, MAX_RESULTS)
    if (!signal.aborted) yield results
  }
}

export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
}

export function openTabs(): ConnectionTab[] {
  return useConnectionStore.getState().tabs
}

export function tabForScope(scopeId: string): ConnectionTab | undefined {
  return openTabs().find((tab) => tab.sessionId === scopeId)
}

export function tabHint(scopeId: string): string | undefined {
  const tab = tabForScope(scopeId)
  if (!tab) return undefined
  return tab.status === 'connected' ? 'connected' : 'tab open'
}

export function isScopeConnected(scopeId: string): boolean {
  return tabForScope(scopeId)?.status === 'connected'
}

export function scopeName(scopeId: string): string {
  const tab = tabForScope(scopeId)
  if (tab) return tab.sessionName
  const session = useSessionStore.getState().sessions.find((s) => s.id === scopeId)
  if (session) return session.name
  const database = useSavedDatabaseStore.getState().databases.find((db) => db.sessionId === scopeId)
  return database ? savedDatabaseLabel(database) : 'Server'
}

export function uniqueScopeIds(): string[] {
  return [...new Set(openTabs().map((tab) => tab.sessionId))]
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

const UNITS: Array<[number, string]> = [
  [86_400_000, 'd'],
  [3_600_000, 'h'],
  [60_000, 'm']
]

export function formatRelative(timestamp: number, now: number): string {
  const age = Math.max(0, now - timestamp)
  const unit = UNITS.find(([size]) => age >= size)
  return unit ? `${Math.floor(age / unit[0])}${unit[1]} ago` : 'just now'
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

export class AsyncQueue<T> {
  private items: T[] = []
  private wake: (() => void) | null = null

  push(item: T): void {
    this.items.push(item)
    this.wake?.()
  }

  async pull(signal: AbortSignal): Promise<T | undefined> {
    while (this.items.length === 0) {
      if (signal.aborted) return undefined
      await this.waitForPush(signal)
    }
    return this.items.shift()
  }

  private waitForPush(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        signal.removeEventListener('abort', done)
        this.wake = null
        resolve()
      }
      this.wake = done
      signal.addEventListener('abort', done, { once: true })
    })
  }
}

export async function* mergeStreams<T>(sources: Array<AsyncIterable<T>>): AsyncGenerator<T> {
  const iterators = sources.map((source) => source[Symbol.asyncIterator]())
  const pending = new Map<number, Promise<{ i: number; result: IteratorResult<T> }>>()
  const advance = (i: number) => pending.set(i, iterators[i].next().then((result) => ({ i, result })))
  iterators.forEach((_, i) => advance(i))
  try {
    while (pending.size > 0) {
      const { i, result } = await Promise.race(pending.values())
      pending.delete(i)
      if (result.done) continue
      yield result.value
      advance(i)
    }
  } finally {
    iterators.forEach((it) => void it.return?.()?.catch(() => {}))
  }
}

export function createTtlCache<T>(ttlMs: number, load: (key: string) => Promise<T>, now: () => number = Date.now) {
  const entries = new Map<string, { at: number; value: Promise<T> }>()
  return (key: string): Promise<T> => {
    const hit = entries.get(key)
    if (hit && now() - hit.at < ttlMs) return hit.value
    const value = load(key)
    entries.set(key, { at: now(), value })
    value.catch(() => entries.delete(key))
    return value
  }
}
