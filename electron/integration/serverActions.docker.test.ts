import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ActionDefinition, ActionRun } from '../../src/types/server/core'
import { findAction } from '../../src/utils/server/areas'
import { fileEditStep } from '../../src/utils/server/fileEdit'
import type { RemoteExec } from '../services/deploy/DeployService'
import { ActionEngine } from '../services/server/ActionEngine'
import { ActivityStore } from '../services/server/ActivityStore'
import { RunStore } from '../services/server/RunStore'
import { ScanService } from '../services/server/ScanService'
import { ExecTimeoutError, type ExecResult } from '../utils/sshExec'

const DOCKER = process.env.SHELLWAY_DOCKER_BIN ?? 'docker'
const ENABLED = process.env.SHELLWAY_DOCKER_IT === '1'
const BOX = process.env.SHELLWAY_IT_ACTION_SERVER ?? 'shellway-it-ubuntu'
const CONNECTION = 'it-connection'

function dockerExec(box: string): RemoteExec {
  return (command, options = {}) => new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(DOCKER, ['exec', '-i', '-u', 'deploy', '-w', '/home/deploy', '-e', 'SSH_CONNECTION=203.0.113.5 50000 172.17.0.2 22', '-e', 'HOME=/home/deploy', '-e', 'USER=deploy', box, 'sh', '-c', command])
    const out: Buffer[] = []
    const err: Buffer[] = []
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new ExecTimeoutError(options.timeoutMs ?? 10_000)) }, options.timeoutMs ?? 10_000)
    child.stdout.on('data', (chunk: Buffer) => { out.push(chunk); options.onOutput?.(chunk.toString('utf8')) })
    child.stderr.on('data', (chunk: Buffer) => { err.push(chunk); options.onOutput?.(chunk.toString('utf8')) })
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      const stdout = Buffer.concat(out).toString('utf8')
      resolve({ stdout, stdoutBytes: Buffer.byteLength(stdout), stderr: Buffer.concat(err).toString('utf8'), code: code ?? -1 })
    })
    const stdin = options.stdin
    if (typeof stdin === 'string' || Buffer.isBuffer(stdin)) child.stdin.end(stdin)
    else if (stdin) stdin.pipe(child.stdin)
    else child.stdin.end()
  })
}

const inBox = (script: string): string => spawnSync(DOCKER, ['exec', '-i', '-u', 'root', BOX, 'sh', '-s'], { input: script, encoding: 'utf8' }).stdout

const TEST_FILE = '/etc/shellway-it/app.conf'

const testActions: ActionDefinition[] = [
  {
    type: 'it.detached',
    area: 'software',
    needs: [],
    validate: (raw) => raw,
    plan: () => ({ title: 'Detached', area: 'software', summary: '', warnings: [], blocked: null, secrets: ['s3cr3t-value'], steps: [{ id: 'long', label: 'Long step', kind: 'command', root: true, detached: true, timeoutSeconds: 60, script: 'echo start; sleep 3; echo "token s3cr3t-value"; echo finished', display: 'long step' }] })
  },
  {
    type: 'it.edit',
    area: 'software',
    needs: [],
    validate: (raw) => raw as { content: string; test: string; original: string | null },
    plan: (params) => {
      const p = params as { content: string; test: string; original: string | null }
      return { title: 'Edit', area: 'software', summary: '', warnings: [], blocked: null, secrets: [], steps: [fileEditStep({ id: 'edit', label: 'Edit file', path: TEST_FILE, content: p.content, originalSha256: p.original, test: p.test, mode: '0644', owner: 'root:root' })] }
    }
  },
  {
    type: 'it.rollback',
    area: 'software',
    needs: [],
    validate: (raw) => raw,
    plan: () => ({
      title: 'Rollback', area: 'software', summary: '', warnings: [], blocked: null, secrets: [],
      steps: [
        fileEditStep({ id: 'edit', label: 'Edit file', path: TEST_FILE, content: 'second\n', originalSha256: sha('first\n'), test: 'true', mode: '0644', owner: 'root:root' }),
        { id: 'fail', label: 'Fails', kind: 'command', root: true, timeoutSeconds: 30, script: 'echo boom; exit 3', display: 'exit 3' }
      ]
    })
  }
]

function sha(text: string): string {
  return spawnSync('shasum', ['-a', '256'], { input: text, encoding: 'utf8' }).stdout.split(' ')[0]
}

function makeEngine() {
  const exec = dockerExec(BOX)
  const dir = mkdtempSync(join(tmpdir(), 'shellway-it-engine-'))
  const updates: ActionRun[] = []
  const output: string[] = []
  const broadcast = (channel: string, payload: unknown) => {
    if (channel === 'server:run-update') updates.push(payload as ActionRun)
    if (channel === 'server:run-output') output.push((payload as { chunk: string }).chunk)
  }
  const scan = new ScanService({ execFor: () => exec, broadcast, now: Date.now })
  const engine = new ActionEngine({
    execFor: () => exec,
    scan,
    store: new RunStore(join(dir, 'runs.json')),
    activity: new ActivityStore(join(dir, 'activity')),
    broadcast,
    newId: () => `it-${Math.random().toString(36).slice(2, 10)}`,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    findAction: (type) => testActions.find((action) => action.type === type) ?? findAction(type)
  })
  const finished = async (runId: string): Promise<ActionRun> => {
    for (let i = 0; i < 240; i++) {
      const last = updates.filter((run) => run.id === runId).at(-1)
      if (last && last.status !== 'running') return last
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error('run did not finish')
  }
  const runAction = async (type: string, params: unknown): Promise<ActionRun> => {
    const plan = await engine.plan(CONNECTION, type, params)
    expect(plan.blocked, JSON.stringify(plan.blocked)).toBeNull()
    const started = await engine.run(CONNECTION, 'it-session', plan.planId)
    if (started.kind !== 'started') throw new Error(`run not started: ${started.kind}`)
    return finished(started.run.id)
  }
  return { engine, runAction, output }
}

describe.skipIf(!ENABLED)(`action engine on ${BOX}`, () => {
  it('runs a detached root step to the end and redacts secrets', async () => {
    const { runAction, output } = makeEngine()
    const run = await runAction('it.detached', {})
    expect(run.status, JSON.stringify(run.failure)).toBe('done')
    const text = output.join('')
    expect(text).toContain('finished')
    expect(text).not.toContain('s3cr3t-value')
  }, 90_000)

  it('writes a config file with backup and refuses when the file changed since review', async () => {
    inBox(`mkdir -p /etc/shellway-it && printf 'first\\n' > ${TEST_FILE}`)
    const { runAction } = makeEngine()
    const done = await runAction('it.edit', { content: 'second\n', test: 'true', original: sha('first\n') })
    expect(done.status, JSON.stringify(done.failure)).toBe('done')
    expect(inBox(`cat ${TEST_FILE}`)).toBe('second\n')
    const changed = await runAction('it.edit', { content: 'third\n', test: 'true', original: sha('first\n') })
    expect(changed.status).toBe('failed')
    expect(changed.failure?.kind).toBe('changed')
    expect(inBox(`cat ${TEST_FILE}`)).toBe('second\n')
  }, 60_000)

  it('restores the file when the config test fails', async () => {
    inBox(`mkdir -p /etc/shellway-it && printf 'first\\n' > ${TEST_FILE}`)
    const { runAction } = makeEngine()
    const run = await runAction('it.edit', { content: 'broken\n', test: 'false', original: sha('first\n') })
    expect(run.status).toBe('failed')
    expect(inBox(`cat ${TEST_FILE}`)).toBe('first\n')
  }, 60_000)

  it('rolls back a finished file edit when a later step fails', async () => {
    inBox(`mkdir -p /etc/shellway-it && printf 'first\\n' > ${TEST_FILE}`)
    const { runAction } = makeEngine()
    const run = await runAction('it.rollback', {})
    expect(run.status).toBe('failed')
    expect(run.steps.map((step) => step.status)).toEqual(['rolled-back', 'failed'])
    expect(inBox(`cat ${TEST_FILE}`)).toBe('first\n')
  }, 60_000)

  it('adds a cron task through the real jobs action', async () => {
    inBox('crontab -u deploy -r 2>/dev/null; true')
    const { runAction } = makeEngine()
    const run = await runAction('jobs.cron-save', { user: 'deploy', ref: null, id: 'it-backup', expression: '30 3 * * *', command: 'echo backup', logOutput: true })
    expect(run.status, JSON.stringify(run.failure)).toBe('done')
    expect(inBox('crontab -u deploy -l')).toContain('echo backup')
  }, 60_000)

  it('restarts nginx through the real services action', async () => {
    const { runAction } = makeEngine()
    const run = await runAction('services.control', { kind: 'systemd', name: 'nginx', verb: 'restart', user: null })
    expect(run.status, JSON.stringify(run.failure)).toBe('done')
    expect(inBox('systemctl is-active nginx').trim()).toBe('active')
  }, 60_000)
})
