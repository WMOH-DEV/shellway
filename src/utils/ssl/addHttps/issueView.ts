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

export interface CertbotChanges {
  file: string
  newFile: boolean
  lines: string[]
  redirectNote: string
}

function nginxChanges(request: IssueRequest, siteFile: string): CertbotChanges {
  const base = `/etc/letsencrypt/live/${lineageFor(request)}`
  return {
    file: siteFile,
    newFile: false,
    lines: [
      'listen 443 ssl;',
      `ssl_certificate ${base}/fullchain.pem;`,
      `ssl_certificate_key ${base}/privkey.pem;`,
      'include /etc/letsencrypt/options-ssl-nginx.conf;',
      'ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;'
    ],
    redirectNote: 'Plus a small server block that redirects port 80 to HTTPS.'
  }
}

function apacheChanges(request: IssueRequest, siteFile: string): CertbotChanges {
  const base = `/etc/letsencrypt/live/${lineageFor(request)}`
  return {
    file: siteFile.replace(/(\.conf)?$/, '-le-ssl.conf'),
    newFile: true,
    lines: [
      '<VirtualHost *:443>',
      `SSLCertificateFile ${base}/fullchain.pem`,
      `SSLCertificateKeyFile ${base}/privkey.pem`,
      'Include /etc/letsencrypt/options-ssl-apache.conf'
    ],
    redirectNote: `Plus a rewrite rule in ${siteFile} that redirects port 80 to HTTPS.`
  }
}

export function certbotChanges(request: IssueRequest, siteFile: string, driver: WebServerDriver): CertbotChanges {
  return driver.kind === 'apache' ? apacheChanges(request, siteFile) : nginxChanges(request, siteFile)
}

export const isMissingServerCertificate = (host: HostnameStatus): boolean => host.origin?.kind === 'none' || host.verdict === 'not-encrypted'

export interface WeakSslHost {
  name: string
  mode: 'Flexible' | 'Off'
  zone: string | null
}

const WEAK_MODES = { flexible: 'Flexible', off: 'Off' } as const

export function weakSslHosts(hostnames: HostnameStatus[], names: string[]): WeakSslHost[] {
  return hostnames.flatMap(({ name, edge }) => {
    const mode = edge.sslMode === 'flexible' || edge.sslMode === 'off' ? WEAK_MODES[edge.sslMode] : null
    return names.includes(name) && edge.state === 'proxied' && mode ? [{ name, mode, zone: edge.zone }] : []
  })
}

export const weakZones = (hosts: WeakSslHost[]): string[] => [...new Set(hosts.flatMap(({ zone }) => (zone ? [zone] : [])))]

function stageTitle(stage: IssueStage, server: string): string {
  const titles: Record<IssueStage, string> = {
    backup: `Backing up the ${server} file failed`,
    staging: 'The staging test failed',
    issue: 'Requesting the certificate failed',
    'nginx-test': `${server} rejected the changed configuration`,
    restore: `Restoring the ${server} file failed`
  }
  return titles[stage]
}

const FILE_UNCHANGED: ReadonlySet<IssueStage> = new Set(['backup', 'staging'])

export interface IssueFailureView {
  title: string
  notes: string[]
  hint: string | null
}

function fileNote(result: IssueResult, stage: IssueStage, server: string): string {
  if (result.restored) return `The ${server} file was restored from its backup${result.backupPath ? ` (${result.backupPath})` : ''}.`
  if (FILE_UNCHANGED.has(stage)) return `The ${server} file was not changed.`
  return `The ${server} file was not restored automatically.${result.backupPath ? ` Your backup is at ${result.backupPath}.` : ''}`
}

export function issueFailureView(result: IssueResult, server: string): IssueFailureView {
  const stage = result.failedStage ?? 'issue'
  const notes = [fileNote(result, stage, server)]
  if (stage === 'staging') notes.push('The real certificate was not requested, so no Let\'s Encrypt limit was used.')
  return { title: stageTitle(stage, server), notes, hint: result.hint }
}
