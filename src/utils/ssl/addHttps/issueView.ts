import type { HostnameStatus, IssueRequest, IssueResult, IssueStage } from '../../../types/ssl'
import type { WebServerDriver } from '../../webServer/driver'
import { issueCommand, issueRequestError, lineageFor, stagingCommand } from '../https/issueCommands'

export interface CommandRow {
  command: string
  why: string
  tag: 'test' | 'issue'
}

export function commandRows(request: IssueRequest, driver: WebServerDriver): CommandRow[] | null {
  if (issueRequestError(request) !== null) return null
  const staging: CommandRow[] = request.staging
    ? [{ command: stagingCommand(request, driver.kind), why: "Staging test against Let's Encrypt. Nothing real is requested.", tag: 'test' }]
    : []
  return [...staging, { command: issueCommand(request, driver.kind), why: `Issues the certificate and updates ${driver.label}`, tag: 'issue' }]
}

export function nginxChangeLines(request: IssueRequest): string[] {
  const base = `/etc/letsencrypt/live/${lineageFor(request)}`
  return [
    'listen 443 ssl;',
    `ssl_certificate ${base}/fullchain.pem;`,
    `ssl_certificate_key ${base}/privkey.pem;`,
    'include /etc/letsencrypt/options-ssl-nginx.conf;',
    'ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;'
  ]
}

export const isMissingServerCertificate = (host: HostnameStatus): boolean => host.origin?.kind === 'none' || host.verdict === 'not-encrypted'

export interface WeakSslHost {
  name: string
  mode: 'Flexible' | 'Off'
}

const WEAK_MODES = { flexible: 'Flexible', off: 'Off' } as const

export function weakSslHosts(hostnames: HostnameStatus[], names: string[]): WeakSslHost[] {
  return hostnames.flatMap(({ name, edge }) => {
    const mode = edge.sslMode === 'flexible' || edge.sslMode === 'off' ? WEAK_MODES[edge.sslMode] : null
    return names.includes(name) && edge.state === 'proxied' && mode ? [{ name, mode }] : []
  })
}

const STAGE_TITLES: Record<IssueStage, string> = {
  backup: 'Backing up the nginx file failed',
  staging: 'The staging test failed',
  issue: 'Requesting the certificate failed',
  'nginx-test': 'nginx rejected the changed file',
  restore: 'Restoring the nginx file failed'
}

const FILE_UNCHANGED: ReadonlySet<IssueStage> = new Set(['backup', 'staging'])

export interface IssueFailureView {
  title: string
  notes: string[]
  hint: string | null
}

function fileNote(result: IssueResult, stage: IssueStage): string {
  if (result.restored) return `The nginx file was restored from its backup${result.backupPath ? ` (${result.backupPath})` : ''}.`
  if (FILE_UNCHANGED.has(stage)) return 'The nginx file was not changed.'
  return `The nginx file was not restored automatically.${result.backupPath ? ` Your backup is at ${result.backupPath}.` : ''}`
}

export function issueFailureView(result: IssueResult): IssueFailureView {
  const stage = result.failedStage ?? 'issue'
  const notes = [fileNote(result, stage)]
  if (stage === 'staging') notes.push('The real certificate was not requested, so no Let\'s Encrypt limit was used.')
  return { title: STAGE_TITLES[stage], notes, hint: result.hint }
}
