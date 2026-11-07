import { describe, expect, it } from 'vitest'
import { DetachedSteps, parseRead, parseStart, RUN_BIN } from './DetachedSteps'
import { action, harness, step } from './testing/engineHarness'
import type { FakeCall } from './testing/FakeRemoteExec'

const isVersion = (call: FakeCall) => call.command.includes('shellway-run" version')
const isInstall = (call: FakeCall) => call.command.includes('cat > "$HOME/.shellway/bin/shellway-run".tmp')
const isStart = (call: FakeCall) => call.command.includes('shellway-run" start')
const isTail = (call: FakeCall) => call.command.startsWith('tail ')
const isRead = (call: FakeCall) => call.command.includes('shellway-run" read')
const isKill = (call: FakeCall) => call.command.includes('shellway-run" kill')

const status = (fields: string, chunk = '') => ({ stdout: `@@status known=1 ${fields}\n${chunk}` })

function detachedHarness(follow: boolean) {
  const h = harness([action('software.install', () => [step('install', { root: true, detached: true, timeoutSeconds: 900, rollback: 'undo-install' }), step('after')])])
  h.fake.on(isVersion, { code: 127 }).on(isInstall, {}).on(isStart, { stdout: `pid=4242\nfollow=${follow ? 1 : 0}\n` })
  return h
}

async function startInstall(h: ReturnType<typeof harness>) {
  const plan = await h.engine.plan('c1', 'software.install', {})
  const result = await h.engine.run('c1', 's1', plan.planId)
  if (result.kind !== 'started') throw new Error(result.kind)
  return result.run
}

describe('parsers', () => {
  it('reads start and status output', () => {
    expect(parseStart('pid=12\nfollow=1\n')).toEqual({ pid: 12, follow: true })
    expect(parseStart('error')).toBeNull()
    expect(parseRead('@@status known=1 alive=1 size=10 exit=\nhello', 44)).toEqual({ known: true, alive: true, exit: null, chunk: 'hello', chunkBytes: 5 })
    expect(parseRead('@@status known=1 alive=0 size=10 exit=3\n', 40)).toMatchObject({ alive: false, exit: 3, chunkBytes: 0 })
  })

  it('ships a versioned run helper', () => {
    expect(DetachedSteps.bundledVersion).toBe(1)
  })
})

describe('detached steps', () => {
  it('installs the helper once, starts the step with sudo, follows the log and finishes', async () => {
    const h = detachedHarness(true)
    h.fake.on(isTail, { stdout: 'Unpacking php8.4 ...\n' }).on(isRead, status('alive=0 size=21 exit=0'))
    const run = await startInstall(h)
    const done = await h.finished(run.id)
    expect(done.status).toBe('done')
    expect(done.steps[0].output).toBe('Unpacking php8.4 ...\n')
    const commands = h.fake.calls.map((call) => call.command)
    expect(commands.slice(0, 6)).toEqual([
      `${RUN_BIN} version 2>/dev/null`,
      `mkdir -p "$HOME/.shellway/bin" "$HOME/.shellway/runs" && chmod 700 "$HOME/.shellway" "$HOME/.shellway/runs" && cat > ${RUN_BIN}.tmp && chmod 755 ${RUN_BIN}.tmp && mv -f ${RUN_BIN}.tmp ${RUN_BIN}`,
      `sudo -n ${RUN_BIN} start ${run.id}-0 900`,
      `tail -c +1 --pid=4242 -f "$HOME/.shellway/runs"/${run.id}-0.log`,
      `${RUN_BIN} read ${run.id}-0 21`,
      'timeout -k 10 30 sh -s'
    ])
    expect(h.fake.calls[1].stdin).toContain('RUN_VERSION=1')
    expect(h.fake.calls[2].stdin).toBe(`export SHELLWAY_RUN_ID='${run.id}'\n{\nrun-install\n} </dev/null\n`)
  })

  it('polls with backoff when tail cannot follow a process', async () => {
    const h = detachedHarness(false)
    const replies = [status('alive=1 size=4 exit=', 'one\n'), status('alive=1 size=4 exit='), status('alive=0 size=8 exit=0', 'two\n')]
    h.fake.on(isRead, () => replies.shift() ?? status('alive=0 size=8 exit=0'))
    const done = await h.finished((await startInstall(h)).id)
    expect(done.steps[0].output).toBe('one\ntwo\n')
    expect(h.fake.calls.filter(isRead).map((call) => call.command.split(' ').pop())).toEqual(['0', '4', '4'])
    expect(h.fake.calls.some(isTail)).toBe(false)
  })

  it('marks the run lost when the process is gone without an exit code', async () => {
    const h = detachedHarness(false)
    h.fake.on(isRead, status('alive=0 size=0 exit='))
    const done = await h.finished((await startInstall(h)).id)
    expect(done.status).toBe('lost')
    expect(done.failure?.kind).toBe('lost')
    expect(h.activity.list('s1')[0].status).toBe('lost')
  })

  it('treats a timeout exit from the helper as a timeout', async () => {
    const h = detachedHarness(false)
    h.fake.on(isRead, status('alive=0 size=0 exit=124'))
    expect((await h.finished((await startInstall(h)).id)).failure).toMatchObject({ kind: 'timeout', message: '"Step install" took longer than 900 seconds and was stopped.' })
  })

  it('waits through a disconnect and resumes following on reconnect', async () => {
    const h = detachedHarness(false)
    let dropped = false
    h.fake.on(isRead, (call) => {
      if (!dropped) {
        dropped = true
        h.setConnected(false)
        return new Error('Channel closed')
      }
      return status('alive=0 size=5 exit=0', 'done\n')
    })
    const run = await startInstall(h)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(h.updates(run.id).at(-1)?.status).toBe('running')
    h.setConnected(true)
    h.engine.reattach('c1', 's1')
    h.engine.reattach('c1', 's1')
    const done = await h.finished(run.id)
    expect(done.status).toBe('done')
    expect(h.fake.calls.filter(isStart)).toHaveLength(1)
    expect(h.fake.calls.filter(isRead)).toHaveLength(2)
  })

  it('reattaches after a restart, follows to the end and does not run the later steps', async () => {
    const first = detachedHarness(false)
    first.fake.on(isRead, () => {
      first.setConnected(false)
      return new Error('Channel closed')
    })
    const run = await startInstall(first)
    await new Promise((resolve) => setTimeout(resolve, 20))

    const second = harness([], { dir: first.dir })
    second.engine.recover()
    expect(second.store.get(run.id)?.run.status).toBe('running')
    second.fake.on(isRead, status('alive=0 size=6 exit=0', 'later\n'))
    second.engine.reattach('c7', 's1')
    const done = await second.finished(run.id)
    expect(done.connectionId).toBe('c7')
    expect(second.events().indexOf('update:running')).toBeLessThan(second.events().indexOf('output'))
    expect(second.events().indexOf('update:running')).toBeGreaterThanOrEqual(0)
    expect(done.steps.map((s) => s.status)).toEqual(['done', 'failed'])
    expect(done.failure?.message).toContain('Shellway restarted during this action')
    expect(second.fake.calls.map((call) => call.command)).toEqual([`${RUN_BIN} read ${run.id}-0 0`])
  })

  it('hides output it can no longer redact after a restart', async () => {
    const first = harness([action('software.install', () => [step('install', { detached: true })], { secrets: ['t0ken'] })])
    first.fake.on(isVersion, { stdout: '1\n' }).on(isStart, { stdout: 'pid=7\nfollow=0\n' }).on(isRead, () => {
      first.setConnected(false)
      return new Error('Channel closed')
    })
    const run = await startInstall(first)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const second = harness([], { dir: first.dir })
    second.fake.on(isRead, status('alive=0 size=9 exit=0', 'key t0ken'))
    second.engine.reattach('c1', 's1')
    const done = await second.finished(run.id)
    expect(done.steps[0].output).not.toContain('t0ken')
    expect(done.steps[0].output).toContain('can no longer hide the secrets')
    expect(first.fake.calls.some(isInstall)).toBe(false)
  })

  it('reattaches to a finished remote step and reads its result', async () => {
    const first = detachedHarness(false)
    first.fake.on(isRead, () => {
      first.setConnected(false)
      return new Error('Channel closed')
    })
    const run = await startInstall(first)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const second = harness([], { dir: first.dir })
    second.engine.recover()
    second.fake.on(isRead, status('alive=0 size=0 exit=1'))
    second.engine.reattach('c2', 's1')
    expect((await second.finished(run.id)).failure).toMatchObject({ kind: 'exit', stepId: 'install' })
  })

  it('kills the remote process when stopped', async () => {
    const h = detachedHarness(false)
    let killed = false
    h.fake.on(isKill, () => { killed = true; return { stdout: 'killed\n' } })
    h.fake.on(isRead, () => (killed ? status('alive=0 size=0 exit=143') : status('alive=1 size=0 exit=')))
    const run = await startInstall(h)
    await new Promise((resolve) => setTimeout(resolve, 10))
    h.engine.stop(run.id)
    const done = await h.finished(run.id)
    expect(done.status).toBe('stopped')
    expect(h.fake.calls.find(isKill)?.command).toBe(`sudo -n ${RUN_BIN} kill ${run.id}-0`)
    expect(h.fake.calls.some((call) => call.stdin?.includes('undo-install'))).toBe(false)
  })
})
