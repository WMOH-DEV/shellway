import { createHash } from 'crypto'
import { join } from 'path'
import type { ActivityEntry, ActivityQuery } from '../../../src/types/server/core'
import { readJson, writeJsonAtomic } from './jsonFile'

export const MAX_ACTIVITY_ENTRIES = 2000
const DEFAULT_LIMIT = 200
const SAFE_KEY = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/

const fileName = (sessionKey: string): string =>
  `${SAFE_KEY.test(sessionKey) ? sessionKey : createHash('sha256').update(sessionKey).digest('hex')}.json`

function matches(entry: ActivityEntry, query: ActivityQuery, text: string): boolean {
  if (query.area && entry.area !== query.area) return false
  if (query.status && entry.status !== query.status) return false
  if (query.before !== undefined && entry.at >= query.before) return false
  return !text || searchable(entry).includes(text)
}

const searchable = (entry: ActivityEntry): string =>
  [entry.title, entry.type, entry.failure?.message ?? '', ...entry.steps.flatMap((step) => [step.label, step.display])].join('\n').toLowerCase()

export class ActivityStore {
  private readonly sessions = new Map<string, ActivityEntry[]>()

  constructor(private readonly dir: string, private readonly cap = MAX_ACTIVITY_ENTRIES) {}

  record(entry: ActivityEntry): void {
    const entries = [entry, ...this.load(entry.sessionKey).filter((existing) => existing.id !== entry.id)]
      .sort((a, b) => b.at - a.at)
      .slice(0, this.cap)
    this.sessions.set(entry.sessionKey, entries)
    writeJsonAtomic(this.path(entry.sessionKey), entries)
  }

  list(sessionKey: string, query: ActivityQuery = {}): ActivityEntry[] {
    const text = query.text?.trim().toLowerCase() ?? ''
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), this.cap)
    return this.load(sessionKey).filter((entry) => matches(entry, query, text)).slice(0, limit)
  }

  private load(sessionKey: string): ActivityEntry[] {
    let entries = this.sessions.get(sessionKey)
    if (!entries) {
      const stored = readJson<unknown>(this.path(sessionKey), [])
      entries = Array.isArray(stored) ? (stored as ActivityEntry[]) : []
      this.sessions.set(sessionKey, entries)
    }
    return entries
  }

  private path(sessionKey: string): string {
    return join(this.dir, fileName(sessionKey))
  }
}
