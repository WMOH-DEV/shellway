import { spawnSync } from 'child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SOURCE = join(import.meta.dirname, '../../../resources/server/shellway-run.sh')
let base: string
let runner: string
let fakeBin: string

function call(args: string[], input = '') {
  const result = spawnSync(runner, args, { input, env: { PATH: `${fakeBin}:${process.env.PATH}`, HOME: base }, encoding: 'utf8' })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

function status(id: string, offset = 0) {
  const { stdout } = call(['read', id, String(offset)])
  const newline = stdout.indexOf('\n')
  const fields = Object.fromEntries(stdout.slice(0, newline).split(' ').slice(1).map((pair) => pair.split('=')))
  return { ...fields, chunk: stdout.slice(newline + 1) } as Record<string, string>
}

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'shellway-run-'))
  mkdirSync(join(base, 'bin'))
  runner = join(base, 'bin', 'shellway-run')
  copyFileSync(SOURCE, runner)
  chmodSync(runner, 0o755)
  fakeBin = join(base, 'fakebin')
  mkdirSync(fakeBin)
  writeFileSync(join(fakeBin, 'timeout'), '#!/bin/sh\nshift 3\nexec "$@"\n')
  chmodSync(join(fakeBin, 'timeout'), 0o755)
})

afterEach(() => rmSync(base, { recursive: true, force: true }))

const exitFile = (id: string) => join(base, 'runs', `${id}.exit`)

describe('shellway-run', () => {
  it('reports its version', () => {
    expect(call(['version']).stdout.trim()).toBe('2')
  })

  it('runs a step detached, logs its output and records the exit code', async () => {
    const started = call(['start', 'run-1', '60'], 'echo hello\necho oops >&2\nexit 3\n')
    expect(started.code).toBe(0)
    expect(started.stdout).toMatch(/^pid=\d+\nfollow=[01]\n$/)
    await until(() => existsSync(exitFile('run-1')))
    const read = status('run-1')
    expect(read).toMatchObject({ known: '1', alive: '0', exit: '3', chunk: 'hello\noops\n' })
    expect(read.size).toBe('11')
    expect(existsSync(join(base, 'runs', 'run-1.sh'))).toBe(false)
  })

  it('reads from an offset', async () => {
    call(['start', 'run-2', '60'], 'printf abcdef\n')
    await until(() => existsSync(exitFile('run-2')))
    expect(status('run-2', 4).chunk).toBe('ef')
  })

  it('reports a running step as alive and stops it on kill', async () => {
    call(['start', 'run-3', '60'], 'echo started\nsleep 30\n')
    await until(() => status('run-3').chunk === 'started\n')
    expect(status('run-3')).toMatchObject({ alive: '1', exit: '' })
    expect(call(['kill', 'run-3']).stdout.trim()).toBe('killed')
    await until(() => existsSync(exitFile('run-3')))
    expect(Number(readFileSync(exitFile('run-3'), 'utf8'))).toBeGreaterThan(128)
  })

  it('says a step is gone when its process died without an exit file', () => {
    mkdirSync(join(base, 'runs'))
    writeFileSync(join(base, 'runs', 'run-4.log'), 'partial')
    writeFileSync(join(base, 'runs', 'run-4.pid'), '999999\n')
    expect(status('run-4')).toMatchObject({ known: '1', alive: '0', exit: '', chunk: 'partial' })
  })

  it('knows nothing about an unknown run', () => {
    expect(status('nope')).toMatchObject({ known: '0', alive: '0' })
  })

  it('refuses a bad run id and a reused one', async () => {
    expect(call(['start', '../x', '60'], 'true').code).toBe(2)
    call(['start', 'run-5', '60'], 'true')
    await until(() => existsSync(exitFile('run-5')))
    expect(call(['start', 'run-5', '60'], 'true').stderr).toContain('already exists')
  })

  it('cancels a step whose supervisor started too late and removes its script', async () => {
    writeFileSync(join(fakeBin, 'nohup'), '#!/bin/sh\nsleep 8\nPATH=${PATH#*:}\nexec nohup "$@"\n')
    chmodSync(join(fakeBin, 'nohup'), 0o755)
    const started = call(['start', 'run-6', '60'], 'echo should-not-run\n')
    expect(started.code).toBe(2)
    const script = join(base, 'runs', 'run-6.sh')
    expect(existsSync(script)).toBe(true)
    await until(() => !existsSync(script), 10000)
    await until(() => !existsSync(join(base, 'runs', 'run-6.cancel')))
    expect(existsSync(join(base, 'runs', 'run-6.child'))).toBe(false)
    expect(readFileSync(join(base, 'runs', 'run-6.log'), 'utf8')).toBe('')
  }, 30000)
})
