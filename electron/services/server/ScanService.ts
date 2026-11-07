import type { ProbeDefinition, ProbeResult, ServerFacts } from '../../../src/types/server/core'
import { SUDO_PROBE, type SudoAccess } from '../../../src/types/server/identity'
import { ALL_PROBES } from '../../../src/utils/server/areas'
import type { RemoteExec } from '../deploy/DeployService'
import { isSudoFailure, lastLine, stdinSafe, TIMEOUT_EXITS } from './remote'

export const FACTS_TTL_MS = 30_000
export const MAX_SCAN_CHANNELS = 3
const KILL_AFTER_SECONDS = 5
const PROBE_OUTPUT_LIMIT = 8 * 1024 * 1024

export interface ScanDeps {
  execFor(connectionId: string): RemoteExec | null
  broadcast(channel: string, ...args: unknown[]): void
  now(): number
  probes?: readonly ProbeDefinition[]
}

class Slots {
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly size: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.size) await new Promise<void>((resolve) => this.waiting.push(resolve))
    else this.active += 1
    try {
      return await task()
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.active -= 1
    }
  }
}

interface ConnectionScan {
  cache: Map<string, ProbeResult>
  inflight: Map<string, Promise<ProbeResult>>
  slots: Slots
}

export class ScanService {
  private readonly connections = new Map<string, ConnectionScan>()
  private readonly probes: Map<string, ProbeDefinition>

  constructor(private readonly deps: ScanDeps) {
    this.probes = new Map((deps.probes ?? ALL_PROBES).map((probe) => [probe.id, probe]))
  }

  facts(connectionId: string): ServerFacts {
    return Object.fromEntries(this.connections.get(connectionId)?.cache ?? [])
  }

  forget(connectionId: string): void {
    this.connections.delete(connectionId)
  }

  async scan(connectionId: string, probeIds: readonly string[] | null, force: boolean): Promise<ServerFacts> {
    const exec = this.deps.execFor(connectionId)
    if (!exec) throw new Error('Not connected')
    const ids = [...new Set(probeIds ?? [...this.probes.keys()])]
    const results = await Promise.all(ids.map(async (id) => [id, await this.resolve(connectionId, exec, id, force)] as const))
    const facts = Object.fromEntries(results)
    this.deps.broadcast('server:facts', connectionId, facts)
    return facts
  }

  private state(connectionId: string): ConnectionScan {
    let state = this.connections.get(connectionId)
    if (!state) {
      state = { cache: new Map(), inflight: new Map(), slots: new Slots(MAX_SCAN_CHANNELS) }
      this.connections.set(connectionId, state)
    }
    return state
  }

  private resolve(connectionId: string, exec: RemoteExec, id: string, force: boolean): Promise<ProbeResult> {
    const probe = this.probes.get(id)
    if (!probe) return Promise.resolve({ status: 'error', error: `Unknown probe ${id}`, at: this.deps.now() })
    const state = this.state(connectionId)
    const cached = state.cache.get(id)
    if (!force && cached && this.deps.now() - cached.at < FACTS_TTL_MS) return Promise.resolve(cached)
    const running = state.inflight.get(id)
    if (running) return running
    const task = this.measure(connectionId, exec, probe, force).then((result) => {
      if (this.connections.get(connectionId) === state) state.cache.set(id, result)
      return result
    }).finally(() => state.inflight.delete(id))
    state.inflight.set(id, task)
    return task
  }

  private async measure(connectionId: string, exec: RemoteExec, probe: ProbeDefinition, force: boolean): Promise<ProbeResult> {
    if (!probe.root) return this.state(connectionId).slots.run(() => this.runProbe(exec, probe, ''))
    const sudo = await this.resolve(connectionId, exec, SUDO_PROBE, force)
    const blocked = sudoBlock(sudo)
    if (blocked) return { status: 'unavailable', reason: blocked, at: this.deps.now() }
    return this.state(connectionId).slots.run(() => this.runProbe(exec, probe, sudoReason(sudo)))
  }

  private async runProbe(exec: RemoteExec, probe: ProbeDefinition, sudoReasonText: string): Promise<ProbeResult> {
    const at = () => this.deps.now()
    const command = `${probe.root ? 'sudo -n ' : ''}timeout -k ${KILL_AFTER_SECONDS} ${probe.timeoutSeconds} sh -s`
    let result
    try {
      result = await exec(command, { stdin: stdinSafe(probe.script), timeoutMs: (probe.timeoutSeconds + KILL_AFTER_SECONDS + 5) * 1000, maxOutputBytes: PROBE_OUTPUT_LIMIT })
    } catch (err) {
      return { status: 'error', error: (err as Error).message, at: at() }
    }
    if (TIMEOUT_EXITS.has(result.code)) return { status: 'error', error: `Timed out after ${probe.timeoutSeconds} seconds`, at: at() }
    if (probe.root && result.code !== 0 && isSudoFailure(result.stderr)) return { status: 'unavailable', reason: sudoReasonText || 'Needs passwordless sudo', at: at() }
    if (result.code !== 0 && !result.stdout.trim()) return { status: 'error', error: lastLine(result.stderr) || `Exited with code ${result.code}`, at: at() }
    try {
      return { status: 'ok', data: probe.parse(result.stdout), at: at() }
    } catch (err) {
      return { status: 'error', error: `Could not read the result: ${(err as Error).message}`, at: at() }
    }
  }
}

function sudoBlock(sudo: ProbeResult): string | null {
  if (sudo.status === 'unavailable') return sudo.reason
  if (sudo.status === 'error') return `Could not check sudo: ${sudo.error}`
  const access = sudo.data as SudoAccess
  return access.passwordless ? null : access.reason
}

const sudoReason = (sudo: ProbeResult): string => (sudo.status === 'ok' ? (sudo.data as SudoAccess).reason : '')
