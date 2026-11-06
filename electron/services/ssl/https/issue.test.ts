import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IssueRequest, ServerBlock, ServerFacts } from '../../../../src/types/ssl'
import { issueCommand, stagingCommand } from '../../../../src/utils/ssl/https/issueCommands'
import type { ExecOptions } from '../../../utils/sshExec'
import type { RemoteExec } from '../../deploy/DeployService'
import type { ServerConfig } from '../SslService'
import { runIssue } from './issue'
import type { IssueHooks } from './issue'

const FILE = '/etc/nginx/sites-enabled/app.conf'
const BACKUP = '/etc/ssl/shellway/backups/app.conf.1800000000'

const request: IssueRequest = { blockId: `${FILE}:1`, names: ['app.example.com'], email: 'admin@example.com', redirect: true, staging: true }

const block: ServerBlock = {
  id: `${FILE}:1`, file: FILE, line: 1, names: ['app.example.com', 'www.example.com'], tls: false,
  certPath: '', keyPath: '', probeAddress: '127.0.0.1:443', root: null
}

const config = (full = true, blocks = [block]): ServerConfig => ({
  facts: { sudo: { certbot: true, nginx: true, full } } as ServerFacts,
  blocks
})

type Responder = (command: string, attempt: number) => { code: number; output?: string } | Error | undefined

let commands: string[]
let stdins: Record<string, unknown>
let hooks: IssueHooks & { rememberEmail: ReturnType<typeof vi.fn> }
let streamed: string[]

function fakeExec(responder: Responder): RemoteExec {
  const attempts = new Map<string, number>()
  return async (command, options?: ExecOptions) => {
    commands.push(command)
    stdins[command] = options?.stdin
    const attempt = (attempts.get(command) ?? 0) + 1
    attempts.set(command, attempt)
    const answer = responder(command, attempt) ?? { code: 0 }
    if (answer instanceof Error) throw answer
    if (answer.output) options?.onOutput?.(answer.output)
    return { stdout: '', stdoutBytes: 0, stderr: '', code: answer.code }
  }
}

const issue = (responder: Responder = () => undefined, cfg: ServerConfig = config(), req: IssueRequest = request) =>
  runIssue(fakeExec(responder), async () => cfg, req, hooks)

beforeEach(() => {
  commands = []
  stdins = {}
  streamed = []
  hooks = { now: () => 1_800_000_000_000, rememberEmail: vi.fn(), onOutput: (chunk) => streamed.push(chunk) }
})

describe('runIssue', () => {
  it('backs up, tests with staging, issues and checks nginx, sending exactly the helper commands', async () => {
    const result = await issue()

    expect(commands).toEqual(['sudo -n sh -s', stagingCommand(request), issueCommand(request), 'sudo -n nginx -t'])
    expect(stdins['sudo -n sh -s']).toBe(`set -e\nmkdir -p -m 700 /etc/ssl/shellway/backups\ncp -p '${FILE}' '${BACKUP}'\n`)
    expect(result).toMatchObject({ ok: true, failedStage: null, restored: false, backupPath: BACKUP, lineage: 'app.example.com', hint: null })
    expect(hooks.rememberEmail).toHaveBeenCalled()
  })

  it('shows every command before its output', async () => {
    const result = await issue((command) => (command === 'sudo -n nginx -t' ? { code: 0, output: 'syntax is ok\n' } : undefined))
    expect(result.output).toBe([
      '$ mkdir -p -m 700 /etc/ssl/shellway/backups',
      `$ cp -p '${FILE}' '${BACKUP}'`,
      `$ ${stagingCommand(request)}`,
      `$ ${issueCommand(request)}`,
      '$ sudo -n nginx -t',
      'syntax is ok',
      ''
    ].join('\n'))
    expect(streamed.join('')).toBe(result.output)
  })

  it('skips the staging run when it is switched off', async () => {
    await issue(() => undefined, config(), { ...request, staging: false })
    expect(commands).toEqual(['sudo -n sh -s', issueCommand({ ...request, staging: false }), 'sudo -n nginx -t'])
  })

  it('stops after a failed staging run without sending the real request', async () => {
    const result = await issue((command) =>
      command === stagingCommand(request) ? { code: 1, output: 'Challenge failed: 404 /.well-known/acme-challenge/x\n' } : undefined)

    expect(commands).toEqual(['sudo -n sh -s', stagingCommand(request)])
    expect(result).toMatchObject({ ok: false, failedStage: 'staging', restored: false, backupPath: BACKUP, lineage: null })
    expect(result.hint).toMatch(/could not reach the challenge file/)
    expect(hooks.rememberEmail).not.toHaveBeenCalled()
  })

  it('restores the backup, tests and reloads nginx when the test fails after issuing', async () => {
    const result = await issue((command, attempt) =>
      command === 'sudo -n nginx -t' && attempt === 1 ? { code: 1, output: 'nginx: configuration file test failed\n' } : undefined)

    expect(commands).toEqual([
      'sudo -n sh -s', stagingCommand(request), issueCommand(request), 'sudo -n nginx -t',
      `sudo -n cp -p '${BACKUP}' '${FILE}'`, 'sudo -n nginx -t', 'sudo -n nginx -s reload'
    ])
    expect(result).toMatchObject({ ok: false, failedStage: 'nginx-test', restored: true, lineage: null })
  })

  it('restores when the issue command and the nginx test both fail', async () => {
    const result = await issue((command, attempt) => {
      if (command === issueCommand(request)) return { code: 1 }
      return command === 'sudo -n nginx -t' && attempt === 1 ? { code: 1 } : undefined
    })
    expect(result).toMatchObject({ ok: false, failedStage: 'issue', restored: true })
    expect(commands.at(-1)).toBe('sudo -n nginx -s reload')
  })

  it('leaves a valid configuration alone when only the issue command failed', async () => {
    const result = await issue((command) => (command === issueCommand(request) ? { code: 1, output: 'too many certificates already issued\n' } : undefined))
    expect(commands).toEqual(['sudo -n sh -s', stagingCommand(request), issueCommand(request), 'sudo -n nginx -t'])
    expect(result).toMatchObject({ ok: false, failedStage: 'issue', restored: false })
    expect(result.hint).toMatch(/rate limit/)
  })

  it('reports a restore that did not work', async () => {
    const result = await issue((command) => {
      if (command === 'sudo -n nginx -t') return { code: 1 }
      return undefined
    })
    expect(result).toMatchObject({ ok: false, failedStage: 'restore', restored: false })
    expect(commands.filter((c) => c === 'sudo -n nginx -t')).toHaveLength(2)
    expect(commands).not.toContain('sudo -n nginx -s reload')
  })

  it('restores after a lost connection during the real request', async () => {
    const result = await issue((command, attempt) => {
      if (command === issueCommand(request)) return new Error('Command timed out after 600000ms')
      return command === 'sudo -n nginx -t' && attempt === 1 ? { code: 1 } : undefined
    })
    expect(result).toMatchObject({ failedStage: 'issue', restored: true })
    expect(result.output).toContain('Command timed out after 600000ms')
  })

  it('stops when the backup fails', async () => {
    const result = await issue((command) => (command === 'sudo -n sh -s' ? { code: 1, output: 'cp: cannot create\n' } : undefined))
    expect(commands).toEqual(['sudo -n sh -s'])
    expect(result).toMatchObject({ ok: false, failedStage: 'backup', backupPath: null })
  })

  it('refuses names that are not in the chosen server block, before running anything', async () => {
    const run = issue(() => undefined, config(), { ...request, names: ['app.example.com', 'other.example.org'] })
    await expect(run).rejects.toThrow('other.example.org is not a name of this site')
    expect(commands).toEqual([])
  })

  it('matches names regardless of the case used in the nginx file', async () => {
    const upper = { ...block, names: ['APP.Example.com'] }
    await expect(issue(() => undefined, config(true, [upper]))).resolves.toMatchObject({ ok: true })
  })

  it('refuses without full sudo, for an unknown site and for an invalid request', async () => {
    await expect(issue(() => undefined, config(false))).rejects.toThrow('Issuing a certificate needs passwordless sudo')
    await expect(issue(() => undefined, config(true, []))).rejects.toThrow('no longer in the nginx configuration')
    await expect(issue(() => undefined, config(), { ...request, email: 'nope' })).rejects.toThrow('Enter a valid email address')
    expect(commands).toEqual([])
  })

  it('quotes a file name that contains a quote', async () => {
    const odd = { ...block, file: "/etc/nginx/conf.d/it's.conf" }
    await issue(() => undefined, config(true, [odd]))
    expect(stdins['sudo -n sh -s']).toContain(`cp -p '/etc/nginx/conf.d/it'\\''s.conf' '/etc/ssl/shellway/backups/it'\\''s.conf.1800000000'`)
  })
})
