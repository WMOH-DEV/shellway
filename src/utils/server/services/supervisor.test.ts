import { execFileSync } from 'child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { isSupervisorProblem, parseSupervisor, SUPERVISOR_SCRIPT } from './supervisor'

function fakeTool(dir: string, name: string, body: string) {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

describe('SUPERVISOR_SCRIPT', () => {
  it('collects status and asks ps only for running pids', () => {
    const dir = mkdtempSync(join(tmpdir(), 'supervisor-'))
    fakeTool(dir, 'supervisorctl', "printf 'web RUNNING   pid 2201, uptime 3:02:11\\nqueue BACKOFF Exited too quickly\\napi RUNNING pid 2202, uptime 0:00:05\\n'")
    fakeTool(dir, 'ps', 'echo "ARGS $*"')
    const stdout = execFileSync('sh', ['-c', SUPERVISOR_SCRIPT], { env: { PATH: `${dir}:/usr/bin:/bin` } }).toString()
    expect(stdout).toContain('@@status\nweb RUNNING')
    expect(stdout).toContain('ARGS -o pid=,pcpu=,rss= -p 2201,2202')
  })
})

const OUTPUT = `@@status
shop-queue:default_00            BACKOFF   Exited too quickly (process log may have details)
shop-queue:emails_00             RUNNING   pid 2201, uptime 3:02:11
shop-queue:emails_01             RUNNING   pid 2202, uptime 3 days, 3:02:11
reports                          STOPPED   Nov 07 09:41 AM
broken                           FATAL     can't find command '/srv/app/bin/missing'
@@ps
 2201  0.6 98304
 2202  1.2 51200
`

describe('parseSupervisor', () => {
  const data = parseSupervisor(OUTPUT)

  it('parses every program with state, pid, uptime and usage', () => {
    if (!data.installed) throw new Error('expected supervisor')
    expect(data.running).toBe(true)
    expect(data.programs).toEqual([
      { name: 'shop-queue:default_00', state: 'BACKOFF', pid: null, uptime: '', description: 'Exited too quickly (process log may have details)', cpuPercent: null, memoryBytes: null },
      { name: 'shop-queue:emails_00', state: 'RUNNING', pid: 2201, uptime: '3:02:11', description: '', cpuPercent: 0.6, memoryBytes: 98304 * 1024 },
      { name: 'shop-queue:emails_01', state: 'RUNNING', pid: 2202, uptime: '3 days, 3:02:11', description: '', cpuPercent: 1.2, memoryBytes: 51200 * 1024 },
      { name: 'reports', state: 'STOPPED', pid: null, uptime: '', description: 'Nov 07 09:41 AM', cpuPercent: null, memoryBytes: null },
      { name: 'broken', state: 'FATAL', pid: null, uptime: '', description: "can't find command '/srv/app/bin/missing'", cpuPercent: null, memoryBytes: null }
    ])
  })

  it('reports a stopped daemon', () => {
    expect(parseSupervisor('@@status\nunix:///var/run/supervisor.sock no such file\n')).toEqual({ installed: true, running: false, programs: [] })
  })

  it('reports a missing tool', () => {
    expect(parseSupervisor('@@missing\n')).toEqual({ installed: false })
  })

  it.each([['FATAL', true], ['BACKOFF', true], ['STOPPED', true], ['RUNNING', false], ['EXITED', false]])('%s is a problem: %s', (state, expected) => {
    expect(isSupervisorProblem(state)).toBe(expected)
  })
})
