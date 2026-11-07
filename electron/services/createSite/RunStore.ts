import Store from 'electron-store'
import type { RunRecord } from '../../../src/types/createSite'

const KEEP_FINISHED_RUNS = 50
const FINISHED: ReadonlySet<RunRecord['phase']> = new Set(['done', 'removed'])

interface Schema {
  runs: Record<string, RunRecord>
}

export class RunStore {
  private readonly store = new Store<Schema>({ name: 'shellway-create-site', defaults: { runs: {} } })

  get(id: string): RunRecord | null {
    return this.store.get('runs')[id] ?? null
  }

  forSession(sessionId: string): RunRecord[] {
    return Object.values(this.store.get('runs')).filter((run) => run.sessionId === sessionId).sort((a, b) => b.createdAt - a.createdAt)
  }

  save(record: RunRecord): void {
    const runs = { ...this.store.get('runs'), [record.id]: record }
    const all = Object.values(runs).sort((a, b) => b.createdAt - a.createdAt)
    const finished = all.filter((run) => FINISHED.has(run.phase)).slice(0, KEEP_FINISHED_RUNS)
    const kept = [...all.filter((run) => !FINISHED.has(run.phase)), ...finished]
    this.store.set('runs', Object.fromEntries(kept.map((run) => [run.id, run])))
  }
}
