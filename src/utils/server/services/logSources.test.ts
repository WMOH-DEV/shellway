import { execFileSync } from 'child_process'
import { describe, expect, it } from 'vitest'
import { capLines, guessPriority, LOG_BUFFER_CAP, splitChunk } from './logLines'
import type { LogSource } from './logChannel'
import { followLogScript, parseLogLines, parseLogSource, readLogScript, serviceLogSource, SYSTEM_LOGS } from './logSources'
import { SERVICES_PROBES } from './probes'

const syntaxOk = (script: string) => execFileSync('sh', ['-n', '-c', script])

const SOURCES: LogSource[] = [
  ...SYSTEM_LOGS.map((log) => ({ kind: 'system' as const, id: log.id })),
  { kind: 'systemd', name: 'nginx' },
  { kind: 'supervisor', name: 'shop-queue:default_00' },
  { kind: 'pm2', name: 'admin', user: 'deploy' },
  { kind: 'container', name: 'status-app' }
]

describe('parseLogSource', () => {
  it.each(SOURCES)('accepts %j', (source) => {
    expect(parseLogSource(source)).toEqual(source)
  })

  it.each([
    null,
    { kind: 'system', id: '/etc/shadow' },
    { kind: 'file', path: '/etc/shadow' },
    { kind: 'systemd', name: "nginx'; reboot; '" },
    { kind: 'pm2', name: 'admin' },
    { kind: 'container', name: '../x' }
  ])('rejects %j', (raw) => {
    expect(() => parseLogSource(raw)).toThrow()
  })

  it.each([[0], [10001], [1.5], ['100']])('rejects line count %j', (lines) => {
    expect(() => parseLogLines(lines)).toThrow('Invalid line count')
  })
})

describe('log scripts', () => {
  it.each(SOURCES)('read and follow scripts for %j are valid shell', (source) => {
    expect(() => syntaxOk(readLogScript(source, 200))).not.toThrow()
    expect(() => syntaxOk(followLogScript(source))).not.toThrow()
  })

  it('reads the journal of a unit and follows from now', () => {
    expect(readLogScript({ kind: 'systemd', name: 'nginx' }, 200)).toContain("journalctl --no-pager -o short-iso -n 200 -u '\\''nginx.service'\\''")
    expect(followLogScript({ kind: 'systemd', name: 'nginx' })).toContain('-n 0 -f')
  })

  it('tails allow-listed files and falls back to the journal', () => {
    const script = readLogScript({ kind: 'system', id: 'auth' }, 50)
    expect(script).toContain('/var/log/auth.log /var/log/secure')
    expect(script).toContain('-u ssh.service -u sshd.service')
  })

  it('follows with tail -F and stops when stdin closes', () => {
    const script = followLogScript({ kind: 'system', id: 'nginx-error' })
    expect(script).toContain('tail -n 0 -F')
    expect(script).toContain('cat <&3')
    expect(script).toContain('kill $p')
  })

  it('runs pm2 logs as the owner', () => {
    expect(readLogScript({ kind: 'pm2', name: 'admin', user: 'deploy' }, 100)).toContain('E="sudo -n -u deploy -H"')
  })

  it('maps a service row to its log source', () => {
    expect(serviceLogSource({ kind: 'pm2', name: 'admin', user: 'deploy' })).toEqual({ kind: 'pm2', name: 'admin', user: 'deploy' })
    expect(serviceLogSource({ kind: 'container', name: 'web', user: null })).toEqual({ kind: 'container', name: 'web' })
  })
})

describe('probe scripts', () => {
  it.each(SERVICES_PROBES.map((probe) => [probe.id, probe.script]))('%s is valid shell', (_id, script) => {
    expect(() => syntaxOk(script)).not.toThrow()
  })
})

describe('log lines', () => {
  it('splits chunks on newlines and keeps the partial line', () => {
    const first = splitChunk('', 'one\ntw')
    expect(first).toEqual({ complete: ['one'], partial: 'tw' })
    expect(splitChunk(first.partial, 'o\r\nthree\n')).toEqual({ complete: ['two', 'three'], partial: '' })
  })

  it('caps the buffer', () => {
    const lines = Array.from({ length: LOG_BUFFER_CAP + 1 }, (_, index) => index)
    expect(capLines(lines)).toHaveLength(4000)
    expect(capLines([1, 2])).toEqual([1, 2])
  })

  it.each([
    ['2026/11/07 09:41:16 [error] 812#812: *1 open() failed', 'err'],
    ['PHP Fatal error: Uncaught Exception', 'err'],
    ['2026/11/07 09:41:16 [warn] 812#812: conflicting server name', 'warning'],
    ['203.0.113.10 - - "GET / HTTP/1.1" 200 612', 'info']
  ])('%s -> %s', (line, priority) => {
    expect(guessPriority(line)).toBe(priority)
  })
})
