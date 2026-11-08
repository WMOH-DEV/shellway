import type { ServerFacts } from '../../types/ssl'
import { timeAgo } from '../deploy/siteStatus'
import { SITE_SERVER_LABELS, siteServer } from '../webServer/siteServer'
import { formatDay } from './time'
import type { Tone } from './tone'

export interface StripPart {
  text: string
  mono?: boolean
}

export interface StripItem {
  key: 'certbot' | 'renewal' | 'sudo' | 'full-sudo'
  parts: StripPart[]
  tone: Tone
}

const plain = (text: string): StripPart[] => [{ text }]
const withMono = (mono: string, text: string): StripPart[] => [{ text: mono, mono: true }, { text }]

function certbotItem(facts: ServerFacts): StripItem {
  return facts.certbot
    ? { key: 'certbot', parts: [{ text: 'certbot' }, { text: facts.certbot, mono: true }], tone: 'neutral' }
    : { key: 'certbot', parts: plain('certbot not installed'), tone: 'neutral' }
}

function renewalItem(facts: ServerFacts, now: number): StripItem {
  const { mechanism, lastRun, lastResult } = facts.renewal
  if (mechanism === 'none') return { key: 'renewal', parts: plain('no automatic renewal'), tone: 'warning' }
  if (lastResult === 'failed') return { key: 'renewal', parts: withMono(mechanism, lastRun === null ? 'last run failed' : `last run failed ${formatDay(lastRun)}`), tone: 'error' }
  if (lastResult === 'success' && lastRun !== null) return { key: 'renewal', parts: withMono(mechanism, `last run ok · ${timeAgo(lastRun, now)}`), tone: 'success' }
  return { key: 'renewal', parts: withMono(mechanism, 'no run recorded'), tone: 'neutral' }
}

function sudoItem(facts: ServerFacts): StripItem {
  const kind = siteServer(facts) ?? 'nginx'
  const server = SITE_SERVER_LABELS[kind]
  const { certbot, installed } = facts.sudo
  const web = facts.sudo[kind]
  if (!installed) return { key: 'sudo', parts: plain('sudo is not installed'), tone: 'error' }
  if (certbot && web) return { key: 'sudo', parts: plain(`sudo for certbot, ${server}`), tone: 'success' }
  if (certbot) return { key: 'sudo', parts: plain('sudo for certbot only'), tone: 'warning' }
  if (web) return { key: 'sudo', parts: plain(`sudo for ${server} only`), tone: 'warning' }
  return { key: 'sudo', parts: plain(`no passwordless sudo for certbot or ${server}`), tone: 'warning' }
}

function fullSudoItem({ sudo }: ServerFacts): StripItem {
  return sudo.full
    ? { key: 'full-sudo', parts: plain('full sudo (Origin CA switch available)'), tone: 'success' }
    : { key: 'full-sudo', parts: plain('no full sudo (Origin CA switch unavailable)'), tone: 'neutral' }
}

export function serverStrip(facts: ServerFacts, now: number): StripItem[] {
  const items = [certbotItem(facts)]
  if (facts.certbot) items.push(renewalItem(facts, now))
  items.push(sudoItem(facts))
  if (facts.sudo.installed) items.push(fullSudoItem(facts))
  return items
}
