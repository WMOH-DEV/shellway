import { describe, expect, it } from 'vitest'
import { EXIT_EDIT_REJECTED, EXIT_FILE_CHANGED } from '../../../src/utils/server/fileEdit'
import { ExecTimeoutError } from '../../utils/sshExec'
import { PLAN_TTL_MS } from './ActionEngine'
import { action, harness, step } from './testing/engineHarness'

const started = async (h: ReturnType<typeof harness>, type = 'software.test', params: unknown = {}) => {
  const plan = await h.engine.plan('c1', type, params)
  const result = await h.engine.run('c1', 's1', plan.planId)
  if (result.kind !== 'started') throw new Error(`expected started, got ${result.kind}`)
  return result.run
}

const commands = (h: ReturnType<typeof harness>) => h.fake.calls.map((call) => call.command)

describe('ActionEngine.plan', () => {
  it('returns a view without scripts and remembers the plan', async () => {
    const h = harness([action('software.test', () => [step('one', { root: true, rollback: 'undo-one', display: 'apt-get install pw=s3cret!' }), step('two', { detached: true, diff: '-a\n+s3cret!' })], { secrets: ['s3cret!'] })])
    const view = await h.engine.plan('c1', 'software.test', {})
    expect(view).toMatchObject({ planId: 'id-1', type: 'software.test', title: 'Do software.test', blocked: null })
    expect(view.steps).toEqual([
      { id: 'one', label: 'Step one', kind: 'command', root: true, display: 'apt-get install pw=••••', detached: false, reversible: true },
      { id: 'two', label: 'Step two', kind: 'command', root: false, display: 'run-two', diff: '-a\n+••••', detached: true, reversible: false }
    ])
    expect(JSON.stringify(view)).not.toContain('script')
    expect(h.scan.scan).toHaveBeenCalledWith('c1', ['software.packages', 'core.sudo', 'core.identity'], true)
  })

  it('rejects unknown actions and invalid params', async () => {
    const strict = { ...action('software.strict', () => []), validate: () => { throw new Error('Invalid version') } }
    const h = harness([strict])
    await expect(h.engine.plan('c1', 'software.nope', {})).rejects.toThrow('Unknown action: software.nope')
    await expect(h.engine.plan('c1', 'software.strict', {})).rejects.toThrow('Invalid version')
  })

  it('blocks a plan with root steps when sudo needs a password, with a sudoers hint', async () => {
    const h = harness([action('software.test', () => [step('one', { root: true })])], { sudo: 'password' })
    const view = await h.engine.plan('c1', 'software.test', {})
    expect(view.blocked?.kind).toBe('sudo')
    expect(view.blocked?.message).toContain('Needs passwordless sudo for deploy')
    expect(view.blocked?.message).toContain('deploy ALL=(ALL) NOPASSWD:ALL')
    await expect(h.engine.run('c1', 's1', view.planId)).rejects.toThrow('Needs passwordless sudo')
  })

  it('does not block plans that need no root', async () => {
    const h = harness([action('software.test', () => [step('one')])], { sudo: 'password' })
    expect((await h.engine.plan('c1', 'software.test', {})).blocked).toBeNull()
  })

  it('refuses plans with duplicate step ids or bad time limits', async () => {
    const h = harness([action('software.dup', () => [step('one'), step('one')]), action('software.slow', () => [step('one', { timeoutSeconds: 0 })])])
    await expect(h.engine.plan('c1', 'software.dup', {})).rejects.toThrow('same id')
    await expect(h.engine.plan('c1', 'software.slow', {})).rejects.toThrow('Invalid time limit')
  })
})

describe('ActionEngine.run', () => {
  it('runs steps in order with sudo -n and timeout, then records activity before the final update', async () => {
    const h = harness([action('software.test', () => [step('one', { root: true, timeoutSeconds: 60 }), step('two')])])
    h.fake.on('run-one', { stdout: 'installed\n' })
    const run = await started(h)
    const done = await h.finished(run.id)
    expect(done.status).toBe('done')
    expect(done.steps.map((s) => [s.status, s.exitCode, s.output])).toEqual([['done', 0, 'installed\n'], ['done', 0, '']])
    expect(commands(h)).toEqual(['sudo -n timeout -k 10 60 sh -s', 'timeout -k 10 30 sh -s'])
    expect(h.fake.calls[0].stdin).toBe("export SHELLWAY_RUN_ID='id-2'\n{\nrun-one\n} </dev/null\n")
    expect(h.fake.calls[0].timeoutMs).toBe(80_000)
    const events = h.events()
    expect(events.indexOf('update:running')).toBeLessThan(events.indexOf('output'))
    expect(events.slice(-2)).toEqual(['activity', 'update:done'])
    expect(h.activity.list('s1')).toMatchObject([{ id: `action:${run.id}`, who: 'you', source: 'action', status: 'done', type: 'software.test' }])
  })

  it('consumes the plan so one click runs once', async () => {
    const h = harness([action('software.test', () => [step('one')])])
    const plan = await h.engine.plan('c1', 'software.test', {})
    const first = await h.engine.run('c1', 's1', plan.planId)
    if (first.kind === 'started') await h.finished(first.run.id)
    await expect(h.engine.run('c1', 's1', plan.planId)).rejects.toThrow('expired')
  })

  it('rejects an expired plan', async () => {
    const h = harness([action('software.test', () => [step('one')])])
    const plan = await h.engine.plan('c1', 'software.test', {})
    h.tick(PLAN_TTL_MS)
    await expect(h.engine.run('c1', 's1', plan.planId)).rejects.toThrow('This plan expired. Review it again.')
  })

  it('returns a fresh plan when the server changed since review', async () => {
    let version = '8.3'
    const h = harness([action('software.test', () => [step('one', { script: `install php${version}` })])])
    const plan = await h.engine.plan('c1', 'software.test', {})
    version = '8.4'
    const result = await h.engine.run('c1', 's1', plan.planId)
    expect(result.kind).toBe('stale')
    if (result.kind !== 'stale') return
    expect(result.plan.planId).not.toBe(plan.planId)
    expect(h.fake.calls).toHaveLength(0)
    expect((await h.engine.run('c1', 's1', result.plan.planId)).kind).toBe('started')
  })

  it('allows one run at a time per server', async () => {
    let release: () => void = () => {}
    const h = harness([action('software.test', () => [step('one')])])
    h.fake.on('run-one', () => new Promise((resolve) => { release = () => resolve({}) }))
    const run = await started(h)
    const second = await h.engine.plan('c1', 'software.test', {})
    expect(await h.engine.run('c1', 's1', second.planId)).toEqual({ kind: 'busy', runId: run.id })
    const otherTab = await h.engine.plan('c2', 'software.test', {})
    expect(await h.engine.run('c2', 's1', otherTab.planId)).toEqual({ kind: 'busy', runId: run.id })
    release()
    await h.finished(run.id)
    expect((await h.engine.run('c1', 's1', second.planId)).kind).toBe('started')
  })

  it('stops at the first failure and undoes finished steps in reverse with their state', async () => {
    const h = harness([action('software.test', () => [
      step('one', { rollback: 'undo-one' }),
      step('two', { rollback: 'undo-two', root: true }),
      step('three'),
      step('four')
    ])])
    h.fake.on('run-one', { stdout: 'SHELLWAY_STATE backup=/var/backups/a b\n' })
    h.fake.on('run-two', { stdout: "SHELLWAY_STATE created=1\nSHELLWAY_STATE PATH=/evil\n" })
    h.fake.on('run-three', { code: 2, stdout: 'E: Unable to locate package nope\n' })
    const run = await started(h)
    const done = await h.finished(run.id)
    expect(done.status).toBe('failed')
    expect(done.failure).toEqual({ kind: 'exit', stepId: 'three', message: '"Step three" failed with exit code 2.\nE: Unable to locate package nope' })
    expect(done.steps.map((s) => s.status)).toEqual(['rolled-back', 'rolled-back', 'failed', 'skipped'])
    const undo = h.fake.calls.slice(3)
    expect(undo.map((call) => call.command)).toEqual(['sudo -n timeout -k 10 30 sh -s', 'timeout -k 10 30 sh -s'])
    expect(undo[0].stdin).toBe("export SHELLWAY_RUN_ID='id-2'\nexport created='1'\n{\nundo-two\n} </dev/null\n")
    expect(undo[1].stdin).toContain("export backup='/var/backups/a b'\n")
    expect(h.outputs(run.id, 'one')).toContain('--- undo ---')
    expect(h.activity.list('s1')[0]).toMatchObject({ status: 'failed', failure: { kind: 'exit', stepId: 'three' } })
  })

  it('says when an undo fails', async () => {
    const h = harness([action('software.test', () => [step('one', { rollback: 'undo-one' }), step('two')])])
    h.fake.on('undo-one', { code: 1 }).on('run-two', { code: 1 })
    const done = await h.finished((await started(h)).id)
    expect(done.steps[0].status).toBe('done')
    expect(done.failure?.message).toContain('Could not undo "Step one". Check the server.')
  })

  it('treats a clean exit as a failure that changed nothing, using the last line', async () => {
    const h = harness([action('software.test', () => [step('one', { cleanExits: [EXIT_EDIT_REJECTED] }), step('two', { cleanExits: [EXIT_FILE_CHANGED] })])])
    h.fake.on('run-one', { code: EXIT_EDIT_REJECTED, stdout: 'nginx: [emerg] bad\nThe test failed, so nothing was changed.\n' })
    const done = await h.finished((await started(h)).id)
    expect(done.failure).toEqual({ kind: 'exit', stepId: 'one', message: 'The test failed, so nothing was changed.' })
  })

  it('reports a changed file as its own failure kind', async () => {
    const h = harness([action('software.test', () => [step('one', { root: true, cleanExits: [EXIT_FILE_CHANGED] })])])
    h.fake.on('run-one', { code: EXIT_FILE_CHANGED, stdout: '/etc/x changed after you reviewed it.\n' })
    expect((await h.finished((await started(h)).id)).failure).toEqual({ kind: 'changed', stepId: 'one', message: '/etc/x changed after you reviewed it.' })
  })

  it('reports a sudo failure, skips root undo and explains how to undo by hand', async () => {
    const h = harness([action('software.test', () => [
      step('one', { rollback: 'undo-one' }),
      step('two', { root: true, rollback: 'undo-two pw=s3cret' }),
      step('three', { root: true })
    ], { secrets: ['s3cret'] })])
    h.fake.on('run-three', { code: 1, stderr: 'sudo: a password is required\n' })
    const done = await h.finished((await started(h)).id)
    expect(done.failure?.kind).toBe('sudo')
    expect(done.steps.map((s) => s.status)).toEqual(['rolled-back', 'done', 'failed'])
    expect(h.fake.calls.some((call) => call.stdin?.includes('undo-two'))).toBe(false)
    expect(done.failure?.message).toContain('these steps were not undone: "Step two"')
    expect(done.failure?.message).toContain('undo-two pw=••••')
    expect(done.failure?.message).not.toContain('s3cret')
  })

  it('reports timeouts from the remote limit and from the connection', async () => {
    const h = harness([action('software.remote', () => [step('one')]), action('software.local', () => [step('two', { timeoutSeconds: 5 })])])
    h.fake.on('run-one', { code: 124 }).on('run-two', new ExecTimeoutError('Command timed out after 25000ms'))
    expect((await h.finished((await started(h, 'software.remote')).id)).failure).toMatchObject({ kind: 'timeout', message: '"Step one" took longer than 30 seconds and was stopped.' })
    expect((await h.finished((await started(h, 'software.local')).id)).failure).toMatchObject({ kind: 'timeout', message: '"Step two" took longer than 5 seconds and was stopped.' })
  })

  it('reports a dropped connection and undoes nothing', async () => {
    const h = harness([action('software.test', () => [step('one', { rollback: 'undo-one' }), step('two')])])
    h.fake.on('run-two', () => {
      h.setConnected(false)
      return new Error('Channel closed')
    })
    const done = await h.finished((await started(h)).id)
    expect(done.failure?.kind).toBe('disconnect')
    expect(done.steps[0].status).toBe('done')
    expect(h.fake.calls).toHaveLength(2)
  })

  it('redacts secrets from streamed output, step output and activity', async () => {
    const h = harness([action('software.test', () => [step('one')], { secrets: ['pa55word'] })])
    h.fake.on('run-one', { stdout: 'login with pa55word done\n' })
    const run = await started(h)
    const done = await h.finished(run.id)
    expect(h.outputs(run.id)).toBe('login with •••• done\n')
    expect(done.steps[0].output).toBe('login with •••• done\n')
    expect(JSON.stringify(h.activity.list('s1'))).not.toContain('pa55word')
  })

  it('stops after the current step when asked', async () => {
    let release: () => void = () => {}
    const h = harness([action('software.test', () => [step('one'), step('two')])])
    h.fake.on('run-one', () => new Promise((resolve) => { release = () => resolve({}) }))
    const run = await started(h)
    h.engine.stop(run.id)
    release()
    const done = await h.finished(run.id)
    expect(done.status).toBe('stopped')
    expect(done.steps.map((s) => s.status)).toEqual(['done', 'skipped'])
    expect(() => h.engine.stop(run.id)).toThrow('not running')
  })

  it('lists recent runs for the connection', async () => {
    const h = harness([action('software.test', () => [step('one')])])
    const run = await started(h)
    await h.finished(run.id)
    expect(h.engine.runs('c1').map((r) => r.id)).toEqual([run.id])
    expect(h.engine.runs('c9')).toEqual([])
  })
})

describe('ActionEngine.recover', () => {
  it('marks a run left running without a detached step as failed', async () => {
    let release: () => void = () => {}
    const first = harness([action('software.test', () => [step('one'), step('two')])])
    first.fake.on('run-one', () => new Promise((resolve) => { release = () => resolve({}) }))
    const run = await started(first)
    const restarted = harness([], { dir: first.dir })
    restarted.engine.recover()
    const [record] = restarted.store.all()
    expect(record.run.status).toBe('failed')
    expect(record.run.failure).toEqual({ kind: 'lost', stepId: 'one', message: 'Shellway closed during this step. Check the server before running it again.' })
    expect(record.run.steps.map((s) => s.status)).toEqual(['failed', 'skipped'])
    expect(restarted.activity.list('s1')).toMatchObject([{ id: `action:${run.id}`, status: 'failed' }])
    release()
  })
})
