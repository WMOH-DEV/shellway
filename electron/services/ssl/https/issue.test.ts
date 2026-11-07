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
const limited = (command: string) => command.replace(/^sudo -n /, 'sudo -n timeout -k 10 570 ')
const COMPARE = `sudo -n cmp -s '${BACKUP}' '${FILE}'`

const request: IssueRequest = { blockId: `${FILE}:1`, names: ['app.example.com'], email: 'admin@example.com', redirect: true, staging: true }

const block: ServerBlock = {
  id: `${FILE}:1`, file: FILE, line: 1, names: ['app.example.com', 'www.example.com'], tls: false,
  certPath: '', keyPath: '', probeAddress: '127.0.0.1:443', root: null
}

const config = (full = true, blocks = [block]): ServerConfig => ({
  facts: { nginxParse: 'full', sudo: { certbot: true, nginx: true, apache: false, full } } as ServerFacts,
  blocks
})

type Responder = (command: string, attempt: number) => { code: number; output?: string; stdout?: string } | Error | undefined

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
    return { stdout: answer.stdout ?? '', stdoutBytes: 0, stderr: '', code: answer.code }
  }
}

const STAGING = limited(stagingCommand(request, 'nginx'))
const ISSUE = limited(issueCommand(request, 'nginx'))

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

    expect(commands).toEqual(['sudo -n sh -s', STAGING, ISSUE, 'sudo -n nginx -t'])
    expect(stdins['sudo -n sh -s']).toBe(`set -e\nmkdir -p -m 700 /etc/ssl/shellway/backups\ncp -p '${FILE}' '${BACKUP}'\n`)
    expect(result).toMatchObject({ ok: true, failedStage: null, restored: false, backupPath: BACKUP, lineage: 'app.example.com', hint: null })
    expect(hooks.rememberEmail).toHaveBeenCalled()
  })

  it('shows every command before its output', async () => {
    const result = await issue((command) => (command === 'sudo -n nginx -t' ? { code: 0, output: 'syntax is ok\n' } : undefined))
    expect(result.output).toBe([
      '$ mkdir -p -m 700 /etc/ssl/shellway/backups',
      `$ cp -p '${FILE}' '${BACKUP}'`,
      `$ ${stagingCommand(request, 'nginx')}`,
      `$ ${issueCommand(request, 'nginx')}`,
      '$ sudo -n nginx -t',
      'syntax is ok',
      ''
    ].join('\n'))
    expect(streamed.join('')).toBe(result.output)
  })

  it('skips the staging run when it is switched off', async () => {
    await issue(() => undefined, config(), { ...request, staging: false })
    expect(commands).toEqual(['sudo -n sh -s', limited(issueCommand({ ...request, staging: false }, 'nginx')), 'sudo -n nginx -t'])
  })

  it('stops after a failed staging run without sending the real request', async () => {
    const result = await issue((command) =>
      command === STAGING ? { code: 1, output: 'Challenge failed: 404 /.well-known/acme-challenge/x\n' } : undefined)

    expect(commands).toEqual(['sudo -n sh -s', STAGING, COMPARE])
    expect(result).toMatchObject({ ok: false, failedStage: 'staging', restored: false, backupPath: BACKUP, lineage: null })
    expect(result.hint).toMatch(/could not reach the challenge file/)
    expect(hooks.rememberEmail).not.toHaveBeenCalled()
  })

  it('restores the backup, tests and reloads nginx when the test fails after issuing', async () => {
    const result = await issue((command, attempt) =>
      command === 'sudo -n nginx -t' && attempt === 1 ? { code: 1, output: 'nginx: configuration file test failed\n' } : undefined)

    expect(commands).toEqual([
      'sudo -n sh -s', STAGING, ISSUE, 'sudo -n nginx -t',
      `sudo -n cp -p '${BACKUP}' '${FILE}'`, 'sudo -n nginx -t', 'sudo -n nginx -s reload'
    ])
    expect(result).toMatchObject({ ok: false, failedStage: 'nginx-test', restored: true, lineage: null })
  })

  it('restores when the issue command and the nginx test both fail', async () => {
    const result = await issue((command, attempt) => {
      if (command === ISSUE) return { code: 1 }
      return command === 'sudo -n nginx -t' && attempt === 1 ? { code: 1 } : undefined
    })
    expect(result).toMatchObject({ ok: false, failedStage: 'issue', restored: true })
    expect(commands.at(-1)).toBe('sudo -n nginx -s reload')
  })

  it('leaves a valid configuration alone when only the issue command failed', async () => {
    const result = await issue((command) => (command === ISSUE ? { code: 1, output: 'too many certificates already issued\n' } : undefined))
    expect(commands).toEqual(['sudo -n sh -s', STAGING, ISSUE, 'sudo -n nginx -t', COMPARE])
    expect(result).toMatchObject({ ok: false, failedStage: 'issue', restored: false })
    expect(result.hint).toMatch(/rate limit/)
  })

  it('limits certbot on the server so it stops before Shellway gives up waiting', async () => {
    await issue()
    expect(STAGING).toBe(`sudo -n timeout -k 10 570 ${stagingCommand(request, 'nginx').slice('sudo -n '.length)}`)
    expect(commands).toContain(ISSUE)
  })

  it('restores the file when a failed certbot run left it changed', async () => {
    const result = await issue((command) => {
      if (command === STAGING) return { code: 1 }
      return command === COMPARE ? { code: 1 } : undefined
    })
    expect(commands).toEqual([
      'sudo -n sh -s', STAGING, COMPARE,
      `sudo -n cp -p '${BACKUP}' '${FILE}'`, 'sudo -n nginx -t', 'sudo -n nginx -s reload'
    ])
    expect(result).toMatchObject({ ok: false, failedStage: 'staging', restored: true })
  })

  it('still reports the certificate when remembering the email fails', async () => {
    hooks.rememberEmail.mockImplementation(() => { throw new Error('disk full') })
    const result = await issue()
    expect(result).toMatchObject({ ok: true, lineage: 'app.example.com' })
    expect(result.output).toContain('Could not remember the email: disk full')
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
      if (command === ISSUE) return new Error('Command timed out after 600000ms')
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

  it('refuses when only part of the nginx configuration could be read', async () => {
    const partial = { ...config(), facts: { ...config().facts, nginxParse: 'partial' } } as ServerConfig
    await expect(issue(() => undefined, partial)).rejects.toThrow('could not read the whole web server configuration')
    expect(commands).toEqual([])
  })

  it('quotes a file name that contains a quote', async () => {
    const odd = { ...block, file: "/etc/nginx/conf.d/it's.conf" }
    await issue(() => undefined, config(true, [odd]))
    expect(stdins['sudo -n sh -s']).toContain(`cp -p '/etc/nginx/conf.d/it'\\''s.conf' '/etc/ssl/shellway/backups/it'\\''s.conf.1800000000'`)
  })
})

describe('runIssue on Apache', () => {
  const SITE = '/etc/apache2/sites-enabled/app.conf'
  const APACHE_BACKUP = '/etc/ssl/shellway/backups/app.conf.1800000000'
  const LIST = "sudo -n find '/etc/apache2/sites-available' '/etc/apache2/sites-enabled' -maxdepth 1 -name '*-le-ssl.conf' -print"
  const NEW_FILES = ['/etc/apache2/sites-available/app-le-ssl.conf', '/etc/apache2/sites-enabled/app-le-ssl.conf']
  const OLD_FILE = '/etc/apache2/sites-available/old-le-ssl.conf'
  const apacheBlock: ServerBlock = { ...block, id: `${SITE}:1`, file: SITE }
  const apacheRequest: IssueRequest = { ...request, blockId: apacheBlock.id, staging: false }
  const APACHE_ISSUE = limited(issueCommand(apacheRequest, 'apache'))
  const apacheConfig = (): ServerConfig => ({
    facts: {
      nginx: null, apache: { version: '2.4.62', layout: 'debian' }, serving: 'apache', nginxParse: 'full',
      sudo: { certbot: true, nginx: false, apache: true, full: true }
    } as ServerFacts,
    blocks: [apacheBlock]
  })
  const listing = (afterIssue: boolean) => ({ code: 0, stdout: [OLD_FILE, ...(afterIssue ? NEW_FILES : [])].join('\n') })
  const apacheIssue = (failing: (command: string, attempt: number) => { code: number } | undefined) =>
    runIssue(fakeExec((command, attempt) => {
      if (command === LIST) return listing(commands.includes(APACHE_ISSUE))
      return failing(command, attempt)
    }), async () => apacheConfig(), apacheRequest, hooks)

  it('issues with the apache plugin and checks Apache with its own test', async () => {
    const result = await apacheIssue(() => undefined)
    expect(commands).toEqual([LIST, 'sudo -n sh -s', APACHE_ISSUE, 'sudo -n apache2ctl configtest'])
    expect(APACHE_ISSUE).toContain('certbot --apache')
    expect(result).toMatchObject({ ok: true, backupPath: APACHE_BACKUP })
  })

  it('removes only the site files certbot added before putting the backup back', async () => {
    const result = await apacheIssue((command, attempt) => (command === 'sudo -n apache2ctl configtest' && attempt === 1 ? { code: 1 } : undefined))
    expect(commands.slice(3)).toEqual([
      'sudo -n apache2ctl configtest', LIST,
      `sudo -n rm -f -- '${NEW_FILES[0]}' '${NEW_FILES[1]}'`,
      `sudo -n cp -p '${APACHE_BACKUP}' '${SITE}'`, 'sudo -n apache2ctl configtest', 'sudo -n systemctl reload apache2'
    ])
    expect(commands.join('\n')).not.toContain(OLD_FILE)
    expect(result).toMatchObject({ ok: false, failedStage: 'nginx-test', restored: true })
  })

  it('cleans up a new site file even when the main site file was not touched', async () => {
    const result = await apacheIssue((command) => (command === APACHE_ISSUE ? { code: 1 } : undefined))
    expect(commands).toContain(`sudo -n rm -f -- '${NEW_FILES[0]}' '${NEW_FILES[1]}'`)
    expect(result).toMatchObject({ ok: false, failedStage: 'issue', restored: true })
  })

  it('leaves everything alone when certbot failed without adding a file', async () => {
    const result = await runIssue(fakeExec((command) => {
      if (command === LIST) return listing(false)
      return command === APACHE_ISSUE ? { code: 1 } : undefined
    }), async () => apacheConfig(), apacheRequest, hooks)
    expect(commands.some((command) => command.includes('rm -f'))).toBe(false)
    expect(result).toMatchObject({ ok: false, failedStage: 'issue', restored: false })
  })

  it('stops before certbot when the existing HTTPS files cannot be listed', async () => {
    const result = await runIssue(fakeExec((command) => (command === LIST ? { code: 1 } : undefined)), async () => apacheConfig(), apacheRequest, hooks)
    expect(commands).toEqual([LIST])
    expect(result).toMatchObject({ ok: false, failedStage: 'backup', restored: false })
  })

  it('does not delete anything and reports no restore when the second listing fails', async () => {
    const result = await runIssue(fakeExec((command, attempt) => {
      if (command === LIST) return attempt === 1 ? listing(false) : { code: 1 }
      return command === 'sudo -n apache2ctl configtest' && attempt === 1 ? { code: 1 } : undefined
    }), async () => apacheConfig(), apacheRequest, hooks)
    expect(commands.some((command) => command.includes('rm -f'))).toBe(false)
    expect(result).toMatchObject({ ok: false, failedStage: 'restore', restored: false })
  })

  it('ignores listed paths outside the folders certbot writes to', async () => {
    const result = await runIssue(fakeExec((command, attempt) => {
      if (command === LIST) return attempt === 1 ? listing(false) : { code: 0, stdout: `${OLD_FILE}\nrelative-le-ssl.conf\n/tmp/x-le-ssl.conf` }
      return command === 'sudo -n apache2ctl configtest' && attempt === 1 ? { code: 1 } : undefined
    }), async () => apacheConfig(), apacheRequest, hooks)
    expect(commands.some((command) => command.includes('rm -f'))).toBe(false)
    expect(result.restored).toBe(true)
  })

  it('refuses a site that already has its certbot HTTPS file, before changing anything', async () => {
    const existing = { code: 0, stdout: '/etc/apache2/sites-available/app-le-ssl.conf' }
    await expect(runIssue(fakeExec((command) => (command === LIST ? existing : undefined)), async () => apacheConfig(), apacheRequest, hooks))
      .rejects.toThrow('app-le-ssl.conf already exists')
    expect(commands).toEqual([LIST])
  })
})
