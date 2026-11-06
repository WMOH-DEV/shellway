import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import type { ExecOptions, ExecResult } from '../../utils/sshExec'
import type { RemoteExec } from '../deploy/DeployService'
import { SslService } from './SslService'

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8')

interface Call {
  command: string
  stdin: string
  options: ExecOptions | undefined
}

interface Responses {
  facts: string
  nginxFull?: string
  nginxFiles?: string
  certbot?: string
}

const done = (stdout: string, code = 0): ExecResult => ({ stdout, stdoutBytes: stdout.length, stderr: '', code })

function probeAnswers(script: string): string {
  const count = script.split('\n').filter((line) => line.startsWith('probe ')).length
  const certificate = fixture('x509-openssl3-le_leaf.txt')
  return Array.from({ length: count }, (_, i) =>
    i === count - 1 ? `@@SW@@ PROBE ${i} nocert\n` : `@@SW@@ PROBE ${i} ok\n${certificate}`
  ).join('')
}

function fakeExec(responses: Responses): { exec: RemoteExec; calls: Call[] } {
  const calls: Call[] = []
  const exec: RemoteExec = async (command, options) => {
    const stdin = typeof options?.stdin === 'string' ? options.stdin : ''
    calls.push({ command, stdin, options })
    if (command === 'sh -s' && stdin.includes('section USER')) return done(responses.facts)
    if (command === 'sh -s' && stdin.includes('for file in')) return done(responses.nginxFiles ?? '')
    if (command === 'sh -s' && stdin.includes('openssl s_client')) return done(probeAnswers(stdin))
    if (/^sudo -n '.*nginx' -T$/.test(command)) return done(responses.nginxFull ?? '', responses.nginxFull === undefined ? 1 : 0)
    if (/^sudo -n '.*certbot' certificates$/.test(command)) return done(responses.certbot ?? '')
    return done('', 127)
  }
  return { exec, calls }
}

const nginxDump = fixture('nginx-T.txt')
const healthy = (): Responses => ({
  facts: fixture('facts-timer-success.txt'),
  nginxFull: nginxDump,
  certbot: fixture('certbot-certificates.txt')
})

describe('SslService.scan with sudo', () => {
  it('reads facts, blocks, lineages and origins in a handful of execs', async () => {
    const { exec, calls } = fakeExec(healthy())
    const scan = await new SslService(exec).scan()
    expect(calls.map((c) => c.command)).toEqual(['sh -s', "sudo -n '/usr/sbin/nginx' -T", "sudo -n '/usr/bin/certbot' certificates", 'sh -s'])
    expect(scan.facts).toMatchObject({ nginxParse: 'full', nginx: '1.24.0', user: 'deploy' })
    expect(scan.blocks).toHaveLength(10)
    expect(scan.lineages.map((l) => l.name)).toEqual(['app.example.com', 'shop.example.net'])
  })

  it('probes every TLS name once, skipping patterns, the catch-all and plain HTTP names', async () => {
    const { exec, calls } = fakeExec(healthy())
    const scan = await new SslService(exec).scan()
    expect(Object.keys(scan.origins).sort()).toEqual([
      'alt.example.com',
      'app.example.com',
      'bare443.example.com',
      'example.net',
      'quic.example.com',
      'v6only.example.net',
      'www.example.com'
    ])
    const probes = calls[3].stdin.split('\n').filter((line) => line.startsWith('probe '))
    expect(probes).toContain("probe 0 '127.0.0.1:443' 'app.example.com'")
    expect(probes).toContain("probe 2 '203.0.113.10:443' 'example.net'")
    expect(probes).toContain("probe 3 '[2001:db8::20]:443' 'v6only.example.net'")
    expect(calls[3].stdin).toContain('timeout 10')
  })

  it('classifies the probed certificates and explains the one that failed', async () => {
    const { exec } = fakeExec(healthy())
    const { origins } = await new SslService(exec).scan()
    expect(origins['app.example.com'].kind).toBe('letsencrypt')
    expect(origins['alt.example.com']).toMatchObject({ kind: 'none', error: 'No certificate presented on 127.0.0.1:8443' })
  })

  it('gives the probe batch a timeout that grows with the number of names but stays bounded', async () => {
    const { exec, calls } = fakeExec(healthy())
    await new SslService(exec).scan()
    expect(calls[3].options?.timeoutMs).toBe(20_000 + 7 * 12_000)
  })

  it('escapes names so a hostile server_name cannot run commands', async () => {
    const dump = '# configuration file /etc/nginx/x.conf:\nserver { listen 443 ssl; server_name "a.example.com;id" "x\'y.example.com"; ssl_certificate /c; }\n'
    const { exec, calls } = fakeExec({ ...healthy(), nginxFull: dump })
    await new SslService(exec).scan()
    const probes = calls.at(-1)!.stdin.split('\n').filter((line) => line.startsWith('probe '))
    expect(probes).toEqual(["probe 0 '127.0.0.1:443' 'a.example.com;id'", "probe 1 '127.0.0.1:443' 'x'\\''y.example.com'"])
  })

  it('uses sudo -n for every privileged command', async () => {
    const { exec, calls } = fakeExec(healthy())
    await new SslService(exec).scan()
    const text = calls.map((c) => `${c.command}\n${c.stdin}`).join('\n')
    expect(text.match(/\bsudo\b/g)?.length).toBeGreaterThanOrEqual(4)
    expect(text).not.toMatch(/\bsudo\b(?! -n )/)
  })

  it('never retries: each command runs once', async () => {
    const { exec, calls } = fakeExec({ ...healthy(), nginxFull: undefined })
    await new SslService(exec).scan()
    const commands = calls.map((c) => c.command)
    expect(commands.filter((c) => c.includes('-T'))).toHaveLength(1)
    expect(commands.filter((c) => c.includes('certificates'))).toHaveLength(1)
  })
})

describe('SslService.scan without sudo', () => {
  const noSudo = (): Responses => ({ facts: fixture('facts-timer-failed.txt'), nginxFiles: nginxDump })

  it('falls back to reading the nginx files and marks the parse partial', async () => {
    const { exec, calls } = fakeExec(noSudo())
    const scan = await new SslService(exec).scan()
    expect(scan.facts.nginxParse).toBe('partial')
    expect(scan.blocks.length).toBeGreaterThan(0)
    expect(calls.some((c) => c.command.startsWith('sudo'))).toBe(false)
    expect(calls.map((c) => c.stdin).join('')).toContain('/etc/nginx/sites-enabled/*')
    expect(calls.map((c) => c.stdin).join('')).toContain('/etc/nginx/conf.d/*.conf')
  })

  it('returns no lineages without running certbot', async () => {
    const { exec, calls } = fakeExec(noSudo())
    const scan = await new SslService(exec).scan()
    expect(scan.lineages).toEqual([])
    expect(calls.some((c) => c.command.includes('certificates'))).toBe(false)
  })

  it('reports the parse as unavailable when no file can be read, and skips probing', async () => {
    const { exec, calls } = fakeExec({ facts: fixture('facts-timer-failed.txt') })
    const scan = await new SslService(exec).scan()
    expect(scan.facts.nginxParse).toBe('unavailable')
    expect(scan.blocks).toEqual([])
    expect(scan.origins).toEqual({})
    expect(calls).toHaveLength(2)
  })

  it('falls back to files when sudo nginx -T fails', async () => {
    const { exec } = fakeExec({ ...healthy(), nginxFull: undefined, nginxFiles: nginxDump })
    const scan = await new SslService(exec).scan()
    expect(scan.facts.nginxParse).toBe('partial')
  })

  it('does nothing about nginx on a server without it', async () => {
    const { exec, calls } = fakeExec({ facts: fixture('facts-cron-bare.txt') })
    const scan = await new SslService(exec).scan()
    expect(scan.facts.nginxParse).toBe('unavailable')
    expect(calls).toHaveLength(1)
  })

  it('does not probe when openssl is missing', async () => {
    const facts = fixture('facts-timer-success.txt').replace(/OpenSSL .*/, 'sh: 1: openssl: not found')
    const { exec, calls } = fakeExec({ ...healthy(), facts })
    const scan = await new SslService(exec).scan()
    expect(scan.origins).toEqual({})
    expect(scan.blocks.length).toBeGreaterThan(0)
    expect(calls.some((c) => c.stdin.includes('s_client'))).toBe(false)
  })
})

describe('SslService.runCertbot', () => {
  it('streams every chunk, runs once and returns the combined output', async () => {
    const calls: Call[] = []
    const exec: RemoteExec = async (command, options) => {
      calls.push({ command, stdin: '', options })
      options?.onOutput?.('Processing app.example.com\n')
      options?.onOutput?.('Congratulations, all simulated renewals succeeded\n')
      return { stdout: 'Processing app.example.com\n', stdoutBytes: 0, stderr: 'Congratulations, all simulated renewals succeeded\n', code: 0 }
    }
    const seen: string[] = []
    const result = await new SslService(exec).runCertbot('app.example.com', 'test', (chunk) => seen.push(chunk))
    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe('sudo -n certbot renew --dry-run --cert-name app.example.com')
    expect(calls[0].options?.timeoutMs).toBe(600_000)
    expect(seen).toEqual(['Processing app.example.com\n', 'Congratulations, all simulated renewals succeeded\n'])
    expect(result).toEqual({ code: 0, output: seen.join('') })
  })

  it('returns a failing exit code and does not retry', async () => {
    let runs = 0
    const exec: RemoteExec = async (_command, options) => {
      runs++
      options?.onOutput?.('Challenge failed\n')
      return done('', 1)
    }
    const result = await new SslService(exec).runCertbot('app.example.com', 'force', () => {})
    expect(runs).toBe(1)
    expect(result).toEqual({ code: 1, output: 'Challenge failed\n' })
  })

  it('refuses a lineage name that is not safe, before touching the server', async () => {
    let runs = 0
    const exec: RemoteExec = async () => {
      runs++
      return done('')
    }
    await expect(new SslService(exec).runCertbot('a;id', 'renew', () => {})).rejects.toThrow('Invalid certificate name')
    expect(runs).toBe(0)
  })
})
