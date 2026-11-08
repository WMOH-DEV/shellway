import type { AlertSettings, ServerFacts, Verdict } from '../../types/ssl'
import { sudoersLine } from '../deploy/sudoers'
import { timeAgo } from '../deploy/siteStatus'
import { SITE_SERVER_LABELS, siteServer } from '../webServer/siteServer'

export type CheckTone = 'ok' | 'bad' | 'warn' | 'muted'

export interface ServerCheckRow {
  id: string
  name: string
  tone: CheckTone
  detail: string
  sudoers: string | null
}

export const SSL_SUDOERS_FILE = '/etc/sudoers.d/shellway-ssl'

const VERDICT_PHRASES: Record<Verdict, string> = {
  broken: 'broken now',
  'will-break': 'will break soon',
  expiring: 'server certificate expires soon',
  'not-encrypted': 'not encrypted to the server',
  unchecked: 'could not be fully checked',
  'no-dns': 'has no DNS record',
  ok: 'fine'
}

function webServerRow(facts: ServerFacts): ServerCheckRow {
  const kind = siteServer(facts)
  if (kind === 'apache') return { id: 'web-server', name: 'Apache', tone: 'ok', detail: facts.apache?.version ?? 'installed', sudoers: null }
  if (kind === 'nginx') return { id: 'web-server', name: 'nginx', tone: 'ok', detail: facts.nginx ?? 'installed', sudoers: null }
  const caddy = facts.otherWebServer === 'caddy'
  const detail = caddy ? 'nginx or Apache not found · Caddy is not read' : 'nginx or Apache not found'
  return { id: 'web-server', name: 'Web server', tone: caddy ? 'warn' : 'bad', detail, sudoers: null }
}

function webSudoRow(facts: ServerFacts): ServerCheckRow {
  const kind = siteServer(facts) ?? 'nginx'
  const path = facts.paths[kind]
  const tool = path?.split('/').pop() ?? SITE_SERVER_LABELS[kind]
  return sudoRow(facts, `sudo-${kind}`, `sudo -n ${tool}`, facts.sudo[kind], path, tool)
}

function opensslRow(facts: ServerFacts): ServerCheckRow {
  if (facts.openssl) return { id: 'openssl', name: 'openssl', tone: 'ok', detail: facts.openssl, sudoers: null }
  return { id: 'openssl', name: 'openssl', tone: 'bad', detail: 'not found · needed to read your server certificates', sudoers: null }
}

function certbotRow(facts: ServerFacts): ServerCheckRow {
  if (facts.certbot) return { id: 'certbot', name: 'certbot', tone: 'ok', detail: facts.certbot, sudoers: null }
  return { id: 'certbot', name: 'certbot', tone: 'warn', detail: 'not installed', sudoers: null }
}

function renewalRow({ renewal }: ServerFacts, hasCertbot: boolean, now: number): ServerCheckRow {
  const base = { id: 'renewal', name: 'Automatic renewal', sudoers: null }
  if (renewal.mechanism === 'none') {
    return hasCertbot
      ? { ...base, tone: 'bad', detail: 'no timer or cron job found' }
      : { ...base, tone: 'muted', detail: 'not applicable without certbot' }
  }
  const when = renewal.lastRun ? ` ${timeAgo(renewal.lastRun, now)}` : ''
  if (renewal.lastResult === 'failed') return { ...base, tone: 'bad', detail: `${renewal.mechanism} · failed${when}` }
  if (renewal.lastResult === 'success') return { ...base, tone: 'ok', detail: `${renewal.mechanism} · last run succeeded${when}` }
  return { ...base, tone: 'warn', detail: `${renewal.mechanism} · last result unknown` }
}

function sudoRow({ user, sudo }: ServerFacts, id: string, name: string, allowed: boolean, path: string | null, tool: string): ServerCheckRow {
  if (allowed) return { id, name, tone: 'ok', detail: 'allowed', sudoers: null }
  if (!sudo.installed) return { id, name, tone: 'muted', detail: 'needs sudo, which is not installed', sudoers: null }
  if (!path) return { id, name, tone: 'muted', detail: `${tool} not found on this server`, sudoers: null }
  return { id, name, tone: 'bad', detail: 'not allowed', sudoers: sudoersLine(user, [path]) }
}

function fullSudoRow({ sudo }: ServerFacts): ServerCheckRow {
  const id = 'sudo-full'
  const name = 'Full passwordless sudo'
  if (!sudo.installed) return { id, name, tone: 'bad', detail: 'sudo is not installed · Shellway runs root commands with sudo -n, so install it (apt-get install sudo, or dnf install sudo)', sudoers: null }
  if (sudo.full) return { id, name, tone: 'ok', detail: 'yes · unlocks switching to Origin CA and installing certbot', sudoers: null }
  return { id, name, tone: 'warn', detail: 'no · needed to switch to Origin CA and to install certbot', sudoers: null }
}

export function serverCheckRows(facts: ServerFacts, now: number): ServerCheckRow[] {
  return [
    webServerRow(facts),
    opensslRow(facts),
    certbotRow(facts),
    renewalRow(facts, facts.certbot !== null, now),
    sudoRow(facts, 'sudo-certbot', 'sudo -n certbot', facts.sudo.certbot, facts.paths.certbot, 'certbot'),
    webSudoRow(facts),
    fullSudoRow(facts)
  ]
}

export function renewalOutputOf(facts: ServerFacts): string | null {
  const output = facts.renewal.output.trim()
  return output === '' ? null : output
}

export function lastAlertText(lastAlert: AlertSettings['lastAlert'], now: number): string | null {
  if (!lastAlert) return null
  return `${lastAlert.host} · ${VERDICT_PHRASES[lastAlert.verdict]} · ${timeAgo(lastAlert.at, now)}`
}
