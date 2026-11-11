import { applyPatch, emptySnapshot, normalizeSnapshot, snapshotStats } from '../../../src/search/cachePatch'
import type { SearchCachePatch, SearchCacheSnapshot, SearchCacheStats } from '../../../src/types/search'
import { readJson, writeJsonAtomic } from '../server/jsonFile'

export class SearchCacheStore {
  private snapshot: SearchCacheSnapshot
  private timer: NodeJS.Timeout | null = null
  private dirty = false

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now,
    private readonly flushDelayMs = 1000
  ) {
    this.snapshot = normalizeSnapshot(readJson<unknown>(filePath, null))
  }

  get(): SearchCacheSnapshot {
    return this.snapshot
  }

  apply(patch: SearchCachePatch): void {
    const next = applyPatch(this.snapshot, patch, this.now())
    if (next === this.snapshot) return
    this.snapshot = next
    this.dirty = true
    this.schedule()
  }

  clear(): void {
    this.snapshot = emptySnapshot()
    this.cancelTimer()
    this.dirty = false
    writeJsonAtomic(this.filePath, this.snapshot)
  }

  stats(): SearchCacheStats {
    return snapshotStats(this.snapshot)
  }

  flush(): void {
    this.cancelTimer()
    if (!this.dirty) return
    try {
      writeJsonAtomic(this.filePath, this.snapshot)
      this.dirty = false
    } catch (err) {
      console.warn(`[search] could not save the search cache: ${(err as Error).message}`)
    }
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), this.flushDelayMs)
    this.timer.unref?.()
  }

  private cancelTimer(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }
}
