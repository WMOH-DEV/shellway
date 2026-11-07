import { describe, expect, it } from 'vitest'
import type { ServerFacts } from '../../../src/types/ssl'
import { makeFacts } from '../../../src/utils/ssl/testReport'
import { fixture } from '../../../src/utils/webServer/apache/testFixtures'
import type { ExecResult } from '../../utils/sshExec'
import type { RemoteExec } from '../deploy/DeployService'
import { apacheSites } from './apacheSites'

const SITES = '/etc/apache2/sites-enabled'
const FILES: Record<string, string> = {
  [`${SITES}/000-default.conf`]: fixture('vhost-000-default.conf'),
  [`${SITES}/api.conf`]: fixture('vhost-api.conf'),
  [`${SITES}/blog.example.org.conf`]: fixture('vhost-blog.example.org.conf'),
  [`${SITES}/shop.example.com.conf`]: fixture('vhost-shop.example.com.conf'),
  [`${SITES}/shop.example.com-le-ssl.conf`]: fixture('vhost-shop.example.com-le-ssl.conf')
}

interface Call {
  command: string
  stdin: string
}

interface Server {
  dumpCode?: number
  unreadable?: string[]
}

const result = (stdout: string, code = 0, stderr = ''): ExecResult => ({ stdout, stderr, code } as ExecResult)

function catFiles(stdin: string, unreadable: string[]): ExecResult {
  const asked = [...stdin.matchAll(/cat '([^']+)'/g)].map((m) => m[1])
  const readable = asked.filter((path) => FILES[path] !== undefined && !unreadable.includes(path))
  const stdout = readable.map((path) => `\n# configuration file ${path}:\n${FILES[path]}`).join('')
  const stderr = asked.filter((path) => !readable.includes(path)).map((path) => `@@SW@@ UNREADABLE ${path}\n`).join('')
  return result(stdout, 0, stderr)
}

function fakeServer(server: Server = {}): { exec: RemoteExec; calls: Call[] } {
  const calls: Call[] = []
  const exec: RemoteExec = async (command, options) => {
    const stdin = typeof options?.stdin === 'string' ? options.stdin : ''
    calls.push({ command, stdin })
    if (command.endsWith("'/usr/sbin/apache2ctl' -S")) return result('', server.dumpCode ?? 0, fixture('apache2ctl-S.txt'))
    if (stdin.includes('for file in')) return result(`\n# configuration file ${SITES}/blog.example.org.conf:\n${FILES[`${SITES}/blog.example.org.conf`]}`)
    if (command.endsWith('sh -s')) return catFiles(stdin, server.unreadable ?? [])
    return result('', 127)
  }
  return { exec, calls }
}

const apacheFacts = (overrides: Partial<ServerFacts> = {}) => makeFacts({
  nginx: null,
  apache: { version: '2.4.62', layout: 'debian' },
  serving: 'apache',
  sudo: { certbot: true, nginx: false, apache: true, full: true },
  paths: { certbot: '/usr/bin/certbot', nginx: null, apache: '/usr/sbin/apache2ctl' },
  ...overrides
})

describe('apacheSites.read', () => {
  it('reads every file apache2ctl -S names and reports a full read', async () => {
    const { exec, calls } = fakeServer()
    const read = await apacheSites.read(exec, apacheFacts())
    expect(read.parse).toBe('full')
    expect(read.blocks.map((b) => b.id)).toContain(`${SITES}/shop.example.com-le-ssl.conf:2`)
    expect(read.blocks.find((b) => b.line === 2)).toMatchObject({ names: ['shop.example.com', 'www.shop.example.com'], tls: true })
    expect(calls.map((c) => c.command)).toEqual(["sudo -n '/usr/sbin/apache2ctl' -S", 'sudo -n sh -s'])
  })

  it('runs -S without sudo and reads files as the user when sudo is not allowed', async () => {
    const { exec, calls } = fakeServer()
    await apacheSites.read(exec, apacheFacts({ sudo: { certbot: false, nginx: false, apache: false, full: false } }))
    expect(calls.map((c) => c.command)).toEqual(["'/usr/sbin/apache2ctl' -S", 'sh -s'])
  })

  it('reports a partial read when one listed file cannot be read', async () => {
    const { exec } = fakeServer({ unreadable: [`${SITES}/api.conf`] })
    const read = await apacheSites.read(exec, apacheFacts())
    expect(read.parse).toBe('partial')
    expect(read.blocks.some((b) => b.file === `${SITES}/api.conf`)).toBe(false)
  })

  it('falls back to the enabled site files when apache2ctl -S fails', async () => {
    const { exec } = fakeServer({ dumpCode: 1 })
    const read = await apacheSites.read(exec, apacheFacts())
    expect(read.parse).toBe('partial')
    expect(read.blocks.map((b) => b.names[0])).toEqual(['blog.example.org'])
  })

  it('quotes every file path it reads', async () => {
    const { exec, calls } = fakeServer()
    await apacheSites.read(exec, apacheFacts())
    const script = calls[1].stdin
    expect(script.split('\n').filter(Boolean)).toHaveLength(5)
    expect(script).not.toMatch(/cat \/etc/)
  })

  it('is unavailable without an Apache control path', async () => {
    const { exec, calls } = fakeServer()
    expect(await apacheSites.read(exec, apacheFacts({ paths: { certbot: null, nginx: null, apache: null } }))).toEqual({ blocks: [], parse: 'unavailable' })
    expect(calls).toHaveLength(0)
  })
})
