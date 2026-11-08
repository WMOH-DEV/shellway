import Store from 'electron-store'
import type { CreateSiteSecrets, RunRecord } from '../../../src/types/createSite'
import { decrypt, encrypt, generateMasterKey } from '../../utils/encryption'
import { defaultCommands } from '../../../src/utils/createSite/deploySite'
import { NO_JOBS } from '../../../src/utils/createSite/laravelJobs'
import { NOTHING_CREATED } from './CreateSiteRun'

const KEEP_FINISHED_RUNS = 50
const FINISHED: ReadonlySet<RunRecord['phase']> = new Set(['done', 'removed'])

interface Schema {
  runs: Record<string, RunRecord>
  masterKey: string
  secrets: Record<string, string>
}

function withDefaults(run: RunRecord): RunRecord {
  const saved = run.input
  const filled = {
    ...saved,
    codeSource: saved.codeSource ?? 'git',
    newRepo: saved.newRepo ?? null,
    localParent: saved.localParent ?? null,
    database: saved.database ?? null,
    env: saved.env ?? false,
    jobs: saved.jobs ?? NO_JOBS,
    buildOutput: saved.buildOutput ?? null,
    spa: saved.spa ?? false
  }
  const input = saved.buildSteps ? filled : { ...filled, ...defaultCommands(filled) }
  return { ...run, input, created: { ...NOTHING_CREATED, ...run.created } }
}

export class RunStore {
  private readonly store = new Store<Schema>({ name: 'shellway-create-site', defaults: { runs: {}, masterKey: '', secrets: {} } })

  private masterKey(): string {
    const existing = this.store.get('masterKey')
    if (existing) return existing
    const key = generateMasterKey()
    this.store.set('masterKey', key)
    return key
  }

  secrets(runId: string): CreateSiteSecrets | null {
    const stored = this.store.get('secrets')[runId]
    if (!stored) return null
    try {
      return JSON.parse(decrypt(stored, this.masterKey())) as CreateSiteSecrets
    } catch {
      return null
    }
  }

  saveSecrets(runId: string, secrets: CreateSiteSecrets): void {
    this.store.set('secrets', { ...this.store.get('secrets'), [runId]: encrypt(JSON.stringify(secrets), this.masterKey()) })
  }

  forgetSecrets(runId: string): void {
    const { [runId]: _forgotten, ...rest } = this.store.get('secrets')
    this.store.set('secrets', rest)
  }

  get(id: string): RunRecord | null {
    const run = this.store.get('runs')[id]
    return run ? withDefaults(run) : null
  }

  forSession(sessionId: string): RunRecord[] {
    return Object.values(this.store.get('runs')).filter((run) => run.sessionId === sessionId).map(withDefaults).sort((a, b) => b.createdAt - a.createdAt)
  }

  save(record: RunRecord): void {
    const runs = { ...this.store.get('runs'), [record.id]: record }
    const all = Object.values(runs).sort((a, b) => b.createdAt - a.createdAt)
    const finished = all.filter((run) => FINISHED.has(run.phase)).slice(0, KEEP_FINISHED_RUNS)
    const kept = [...all.filter((run) => !FINISHED.has(run.phase)), ...finished]
    this.store.set('runs', Object.fromEntries(kept.map((run) => [run.id, run])))
    if (FINISHED.has(record.phase)) this.forgetSecrets(record.id)
  }
}
