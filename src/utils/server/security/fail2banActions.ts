import type { ActionDefinition, ActionPlan, ActionStep } from '@/types/server/core'
import { aptInstallScript } from '../apt'
import { fileEditStep } from '../fileEdit'
import { FAIL2BAN_PROBE, SHELLWAY_JAIL, type Fail2banFacts } from './fail2ban'
import { commandStep, factData, needsRoot, precondition, securityPlan, unavailable } from './plan'
import { shq } from './shell'
import { UFW_PROBE, type UfwFacts } from './ufw'
import { asRecord, assertIp, assertOneOf } from './validate'

export interface JailSettings {
  bantime: number
  findtime: number
  maxretry: number
}

export const DEFAULT_JAIL: JailSettings = { bantime: 3600, findtime: 600, maxretry: 5 }
const LOCAL_IGNORE = ['127.0.0.1/8', '::1']
const IGNORE_ENTRY = /^[A-Za-z0-9.:/_-]{1,64}$/

export function usesSystemdBackend(osId: string, osVersion: string): boolean {
  return osId === 'debian' && Number.parseInt(osVersion, 10) >= 12
}

export function mergeIgnore(...lists: string[][]): string[] {
  return [...new Set(lists.flat().map((entry) => entry.trim()).filter((entry) => IGNORE_ENTRY.test(entry)))]
}

export function jailContent(settings: JailSettings, ignoreIp: string[], systemdBackend: boolean): string {
  return [
    '[sshd]',
    'enabled = true',
    ...(systemdBackend ? ['backend = systemd'] : []),
    `maxretry = ${settings.maxretry}`,
    `findtime = ${settings.findtime}`,
    `bantime = ${settings.bantime}`,
    `ignoreip = ${ignoreIp.join(' ')}`,
    ''
  ].join('\n')
}

function currentSettings(f2b: Fail2banFacts): JailSettings {
  return {
    bantime: f2b.sshd?.bantime ?? DEFAULT_JAIL.bantime,
    findtime: f2b.sshd?.findtime ?? DEFAULT_JAIL.findtime,
    maxretry: f2b.sshd?.maxretry ?? DEFAULT_JAIL.maxretry
  }
}

function jailStep(f2b: Fail2banFacts, settings: JailSettings, ignoreIp: string[], reload: string): ActionStep {
  return fileEditStep({
    id: 'jail',
    label: 'Write fail2ban settings',
    path: SHELLWAY_JAIL,
    content: jailContent(settings, ignoreIp, usesSystemdBackend(f2b.osId, f2b.osVersion)),
    originalSha256: f2b.jailFile?.sha256 ?? null,
    mode: '644',
    owner: 'root:root',
    test: 'fail2ban-client -t',
    reload,
    verify: 'fail2ban-client status sshd'
  })
}

function guardFacts(facts: Parameters<ActionDefinition['plan']>[1], what: string): { f2b: Fail2banFacts | null; blocked: ActionPlan['blocked'] } {
  const f2b = factData<Fail2banFacts>(facts, FAIL2BAN_PROBE)
  if (!f2b) return { f2b: null, blocked: unavailable('fail2ban') }
  if (!f2b.root) return { f2b, blocked: needsRoot(what) }
  return { f2b, blocked: null }
}

const install: ActionDefinition<Record<string, never>> = {
  type: 'security.fail2ban.install',
  area: 'security',
  needs: [FAIL2BAN_PROBE],
  validate: () => ({}),
  plan(_params, facts) {
    const { f2b, blocked } = guardFacts(facts, 'Installing fail2ban')
    const title = 'Install fail2ban'
    if (!f2b || blocked) return securityPlan({ title, summary: '', steps: [], blocked })
    const systemd = usesSystemdBackend(f2b.osId, f2b.osVersion)
    const packages = systemd ? ['fail2ban', 'python3-systemd'] : ['fail2ban']
    const ignore = mergeIgnore(LOCAL_IGNORE, f2b.sshd?.ignoreIp ?? [], [f2b.clientIp])
    return securityPlan({
      title,
      summary: `Installs fail2ban and protects SSH: ${DEFAULT_JAIL.maxretry} failed logins in 10 minutes ban the address for 1 hour. Your IP ${f2b.clientIp || ''} is never banned.`,
      steps: [
        { ...commandStep('install', 'Install fail2ban', aptInstallScript(packages), { timeoutSeconds: 900 }), detached: true },
        jailStep(f2b, DEFAULT_JAIL, ignore, 'systemctl enable fail2ban && systemctl restart fail2ban')
      ],
      blocked: f2b.installed ? precondition('fail2ban is already installed.') : null
    })
  }
}

function boundedInteger(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${label}`)
  return value
}

const configure: ActionDefinition<JailSettings> = {
  type: 'security.fail2ban.configure',
  area: 'security',
  needs: [FAIL2BAN_PROBE],
  validate(raw) {
    const input = asRecord(raw)
    return {
      bantime: boundedInteger(input.bantime, 60, 30 * 86400, 'ban time'),
      findtime: boundedInteger(input.findtime, 60, 86400, 'time window'),
      maxretry: boundedInteger(input.maxretry, 1, 100, 'number of attempts')
    }
  },
  plan(params, facts) {
    const { f2b, blocked } = guardFacts(facts, 'Changing fail2ban settings')
    const title = 'Change fail2ban settings'
    if (!f2b || blocked) return securityPlan({ title, summary: '', steps: [], blocked })
    const ignore = mergeIgnore(LOCAL_IGNORE, f2b.sshd?.ignoreIp ?? [], [f2b.clientIp])
    return securityPlan({
      title,
      summary: `Ban for ${params.bantime / 60} min after ${params.maxretry} failed logins in ${params.findtime / 60} min.`,
      steps: [jailStep(f2b, params, ignore, 'fail2ban-client reload')],
      blocked: f2b.running ? null : precondition('fail2ban is not running.')
    })
  }
}

interface IgnoreParams {
  ip: string
  op: 'add' | 'remove'
}

const ignore: ActionDefinition<IgnoreParams> = {
  type: 'security.fail2ban.ignore',
  area: 'security',
  needs: [FAIL2BAN_PROBE],
  validate(raw) {
    const input = asRecord(raw)
    return { ip: assertIp(input.ip), op: assertOneOf(input.op, ['add', 'remove'] as const, 'operation') }
  },
  plan(params, facts) {
    const { f2b, blocked } = guardFacts(facts, 'Changing the ignore list')
    const title = params.op === 'add' ? `Never ban ${params.ip}` : `Remove ${params.ip} from the ignore list`
    if (!f2b || blocked) return securityPlan({ title, summary: '', steps: [], blocked })
    const current = mergeIgnore(LOCAL_IGNORE, f2b.sshd?.ignoreIp ?? [])
    const next = params.op === 'add' ? mergeIgnore(current, [params.ip]) : current.filter((entry) => entry !== params.ip)
    const warnings = params.op === 'remove' && params.ip === f2b.clientIp ? ['This is your current IP. fail2ban could ban you after a few failed logins.'] : []
    const missing = params.op === 'remove' && !current.includes(params.ip)
    return securityPlan({
      title,
      summary: `ignoreip = ${next.join(' ')}`,
      steps: [jailStep(f2b, currentSettings(f2b), next, 'fail2ban-client reload')],
      warnings,
      blocked: !f2b.running ? precondition('fail2ban is not running.') : missing ? precondition(`${params.ip} is not on the ignore list.`) : null
    })
  }
}

const unban: ActionDefinition<{ ip: string }> = {
  type: 'security.fail2ban.unban',
  area: 'security',
  needs: [FAIL2BAN_PROBE],
  validate: (raw) => ({ ip: assertIp(asRecord(raw).ip) }),
  plan(params, facts) {
    const { f2b, blocked } = guardFacts(facts, 'Unbanning an address')
    const title = `Unban ${params.ip}`
    if (!f2b || blocked) return securityPlan({ title, summary: '', steps: [], blocked })
    return securityPlan({
      title,
      summary: `${params.ip} can try to log in again.`,
      steps: [commandStep('unban', `Unban ${params.ip}`, `fail2ban-client set sshd unbanip ${shq(params.ip)}`)]
    })
  }
}

const installUfw: ActionDefinition<Record<string, never>> = {
  type: 'security.ufw.install',
  area: 'security',
  needs: [UFW_PROBE],
  validate: () => ({}),
  plan(_params, facts) {
    const ufw = factData<UfwFacts>(facts, UFW_PROBE)
    const title = 'Install ufw'
    if (!ufw) return securityPlan({ title, summary: '', steps: [], blocked: unavailable('the firewall') })
    return securityPlan({
      title,
      summary: 'Installs the ufw firewall. It stays off until you turn it on.',
      steps: [{ ...commandStep('install', 'Install ufw', aptInstallScript(['ufw']), { timeoutSeconds: 900 }), detached: true }],
      blocked: !ufw.root ? needsRoot('Installing ufw') : ufw.installed ? precondition('ufw is already installed.') : null
    })
  }
}

export const fail2banActions: ActionDefinition[] = [install, configure, ignore, unban, installUfw] as ActionDefinition[]
