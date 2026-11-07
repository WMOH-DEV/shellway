import type { ActionRun } from '../../../src/types/server/core'
import type { DetachedRef } from './DetachedSteps'
import { readJson, writeJsonAtomic } from './jsonFile'

export const KEEP_FINISHED_RUNS = 50

export interface StoredRun {
  run: ActionRun
  detached: DetachedRef | null
  state: Record<string, Record<string, string>>
  hasSecrets: boolean
}

export class RunStore {
  private records: Map<string, StoredRun> | null = null

  constructor(private readonly path: string) {}

  all(): StoredRun[] {
    return [...this.load().values()].sort((a, b) => b.run.startedAt - a.run.startedAt)
  }

  get(id: string): StoredRun | null {
    return this.load().get(id) ?? null
  }

  save(record: StoredRun): void {
    const records = this.load()
    records.set(record.run.id, record)
    const sorted = this.all()
    const finished = sorted.filter((r) => r.run.status !== 'running')
    finished.slice(KEEP_FINISHED_RUNS).forEach((r) => records.delete(r.run.id))
    writeJsonAtomic(this.path, [...records.values()])
  }

  private load(): Map<string, StoredRun> {
    this.records ??= new Map(readJson<StoredRun[]>(this.path, []).filter((r) => r?.run?.id).map((r) => [r.run.id, r]))
    return this.records
  }
}
