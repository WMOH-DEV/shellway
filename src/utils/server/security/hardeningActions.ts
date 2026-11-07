import type { ActionDefinition, ActionStep } from '@/types/server/core'
import { aptInstallScript } from '../apt'
import { fileEditStep } from '../fileEdit'
import { AUTO_UPGRADES_FILE, HARDENING_PROBE, SWAP_FILE, TIMEZONES_PROBE, type HardeningFacts } from './hardening'
import { commandStep, factData, precondition, securityPlan, unavailable } from './plan'
import { shq } from './shell'
import { asRecord, assertBoolean } from './validate'

export const SWAP_SIZES = [1, 2, 4, 8] as const
const GIB = 1024 ** 3
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/
const TIMEZONE = /^[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+){0,2}$/
const FSTAB_SWAP = `${SWAP_FILE} none swap sw 0 0`

const hardeningOf = (facts: Parameters<ActionDefinition['plan']>[1]) => factData<HardeningFacts>(facts, HARDENING_PROBE)

export function autoUpgradesContent(enabled: boolean): string {
  const value = enabled ? '1' : '0'
  return `APT::Periodic::Update-Package-Lists "${value}";\nAPT::Periodic::Unattended-Upgrade "${value}";\n`
}

const unattended: ActionDefinition<{ enabled: boolean }> = {
  type: 'security.unattended',
  area: 'security',
  needs: [HARDENING_PROBE],
  validate: (raw) => ({ enabled: assertBoolean(asRecord(raw).enabled, 'setting') }),
  plan(params, facts) {
    const hardening = hardeningOf(facts)
    const title = params.enabled ? 'Turn on automatic security updates' : 'Turn off automatic security updates'
    if (!hardening) return securityPlan({ title, summary: '', steps: [], blocked: unavailable('update settings') })
    const install: ActionStep[] = params.enabled && !hardening.unattendedInstalled ? [{ ...commandStep('install', 'Install unattended-upgrades', aptInstallScript(['unattended-upgrades']), { timeoutSeconds: 900 }), detached: true }] : []
    const edit = fileEditStep({
      id: 'periodic',
      label: `Write ${AUTO_UPGRADES_FILE}`,
      path: AUTO_UPGRADES_FILE,
      content: autoUpgradesContent(params.enabled),
      originalSha256: hardening.autoUpgradesFile?.sha256 ?? null,
      mode: '644',
      owner: 'root:root',
      verify: `apt-config dump | grep -q 'APT::Periodic::Unattended-Upgrade "${params.enabled ? 1 : 0}"'`
    })
    return securityPlan({
      title,
      summary: params.enabled ? 'Security updates install every day. The server does not reboot by itself.' : 'Security updates stop installing by themselves.',
      steps: [...install, edit]
    })
  }
}

export function fstabWithSwap(fstab: string, present: boolean): string {
  const lines = fstab.split('\n').filter((line, index, all) => index < all.length - 1 || line !== '').filter((line) => line.trim().split(/\s+/)[0] !== SWAP_FILE)
  return `${[...lines, ...(present ? [FSTAB_SWAP] : [])].join('\n')}\n`
}

function createSwapSteps(hardening: HardeningFacts, sizeGb: number): ActionStep[] {
  const mb = sizeGb * 1024
  return [
    commandStep('swapfile', `Create a ${sizeGb} GB swap file`, [
      'set -e',
      `if [ -e ${SWAP_FILE} ]; then echo "${SWAP_FILE} already exists" >&2; exit 2; fi`,
      `fallocate -l ${sizeGb}G ${SWAP_FILE} || dd if=/dev/zero of=${SWAP_FILE} bs=1M count=${mb} status=none`,
      `chmod 600 ${SWAP_FILE}`,
      `mkswap ${SWAP_FILE}`,
      `swapon ${SWAP_FILE}`
    ].join('\n'), { timeoutSeconds: 300, rollback: `swapoff ${SWAP_FILE} 2>/dev/null; rm -f ${SWAP_FILE}` }),
    fileEditStep({ id: 'fstab', label: 'Turn the swap file on at boot', path: '/etc/fstab', content: fstabWithSwap(hardening.fstab?.content ?? '', true), originalSha256: hardening.fstab?.sha256 ?? null, mode: '644', owner: 'root:root', verify: `grep -q '^${SWAP_FILE} ' /etc/fstab` })
  ]
}

function removeSwapSteps(hardening: HardeningFacts): ActionStep[] {
  return [
    fileEditStep({ id: 'fstab', label: 'Stop turning the swap file on at boot', path: '/etc/fstab', content: fstabWithSwap(hardening.fstab?.content ?? '', false), originalSha256: hardening.fstab?.sha256 ?? null, mode: '644', owner: 'root:root' }),
    commandStep('swapoff', 'Turn off and delete the swap file', `set -e\nswapoff ${SWAP_FILE}\nrm -f ${SWAP_FILE}`, { timeoutSeconds: 300 })
  ]
}

function swapBlock(hardening: HardeningFacts, sizeGb: number) {
  const ownSwap = hardening.swaps.some((swap) => swap.name === SWAP_FILE)
  if (sizeGb === 0) return ownSwap ? null : precondition(`There is no ${SWAP_FILE} to remove.`)
  if (hardening.swaps.length > 0) return precondition('Swap is already on. Remove it first to change the size.')
  if (hardening.rootFreeBytes === null) return unavailable('free disk space')
  return hardening.rootFreeBytes < (sizeGb + 1) * GIB ? precondition(`Not enough free disk space for a ${sizeGb} GB swap file.`) : null
}

const swap: ActionDefinition<{ sizeGb: number }> = {
  type: 'security.swap',
  area: 'security',
  needs: [HARDENING_PROBE],
  validate(raw) {
    const size = asRecord(raw).sizeGb
    if (size !== 0 && !SWAP_SIZES.includes(size as (typeof SWAP_SIZES)[number])) throw new Error('Invalid swap size')
    return { sizeGb: size as number }
  },
  plan(params, facts) {
    const hardening = hardeningOf(facts)
    const title = params.sizeGb === 0 ? 'Remove the swap file' : `Add a ${params.sizeGb} GB swap file`
    if (!hardening) return securityPlan({ title, summary: '', steps: [], blocked: unavailable('swap') })
    return securityPlan({
      title,
      summary: params.sizeGb === 0 ? `Turns off ${SWAP_FILE} and deletes it.` : `Creates ${SWAP_FILE} so the server can use disk when memory runs out.`,
      steps: params.sizeGb === 0 ? removeSwapSteps(hardening) : createSwapSteps(hardening, params.sizeGb),
      blocked: swapBlock(hardening, params.sizeGb)
    })
  }
}

const timesync: ActionDefinition<Record<string, never>> = {
  type: 'security.timesync',
  area: 'security',
  needs: [HARDENING_PROBE],
  validate: () => ({}),
  plan(_params, facts) {
    const hardening = hardeningOf(facts)
    const title = 'Turn on time sync'
    if (!hardening) return securityPlan({ title, summary: '', steps: [], blocked: unavailable('time settings') })
    const install: ActionStep[] = hardening.canNtp ? [] : [{ ...commandStep('install', 'Install systemd-timesyncd', aptInstallScript(['systemd-timesyncd']), { timeoutSeconds: 900 }), detached: true }]
    return securityPlan({
      title,
      summary: 'Keeps the clock right. Certificates and logs need it.',
      steps: [...install, commandStep('ntp', 'Turn on network time', 'timedatectl set-ntp true', { rollback: 'timedatectl set-ntp false' })],
      blocked: hardening.ntpEnabled ? precondition('Time sync is already on.') : null
    })
  }
}

const timezone: ActionDefinition<{ timezone: string }> = {
  type: 'security.timezone',
  area: 'security',
  needs: [HARDENING_PROBE, TIMEZONES_PROBE],
  validate(raw) {
    const value = asRecord(raw).timezone
    if (typeof value !== 'string' || !TIMEZONE.test(value)) throw new Error('Invalid time zone')
    return { timezone: value }
  },
  plan(params, facts) {
    const hardening = hardeningOf(facts)
    const zones = factData<string[]>(facts, TIMEZONES_PROBE)
    const title = `Set time zone to ${params.timezone}`
    if (!hardening || !zones) return securityPlan({ title, summary: '', steps: [], blocked: unavailable('time zones') })
    const rollback = /^[A-Za-z0-9_+/-]+$/.test(hardening.timezone) ? `timedatectl set-timezone ${shq(hardening.timezone)}` : undefined
    return securityPlan({
      title,
      summary: `From ${hardening.timezone || 'unknown'} to ${params.timezone}. Cron jobs run on the new clock.`,
      steps: [commandStep('timezone', 'Set the time zone', `timedatectl set-timezone ${shq(params.timezone)}`, { rollback })],
      blocked: !zones.includes(params.timezone) ? precondition(`${params.timezone} is not a time zone this server knows.`) : params.timezone === hardening.timezone ? precondition('That is already the time zone.') : null
    })
  }
}

export function hostsWithHostname(hosts: string, hostname: string): string {
  const short = hostname.split('.')[0]
  const entry = short === hostname ? `127.0.1.1\t${hostname}` : `127.0.1.1\t${hostname} ${short}`
  const lines = hosts.split('\n').filter((line, index, all) => index < all.length - 1 || line !== '')
  const at = lines.findIndex((line) => /^127\.0\.1\.1\s/.test(line))
  if (at >= 0) lines[at] = entry
  else lines.splice(Math.min(1, lines.length), 0, entry)
  return `${lines.join('\n')}\n`
}

const hostname: ActionDefinition<{ hostname: string }> = {
  type: 'security.hostname',
  area: 'security',
  needs: [HARDENING_PROBE],
  validate(raw) {
    const value = asRecord(raw).hostname
    if (typeof value !== 'string' || !HOSTNAME.test(value)) throw new Error('Use lowercase letters, numbers, dashes and dots')
    return { hostname: value }
  },
  plan(params, facts) {
    const hardening = hardeningOf(facts)
    const title = `Rename server to ${params.hostname}`
    if (!hardening?.hosts) return securityPlan({ title, summary: '', steps: [], blocked: unavailable('the host name') })
    const rollback = HOSTNAME.test(hardening.hostname) ? `hostnamectl set-hostname ${shq(hardening.hostname)}` : undefined
    return securityPlan({
      title,
      summary: `From ${hardening.hostname} to ${params.hostname}.`,
      steps: [
        commandStep('hostname', 'Set the host name', `hostnamectl set-hostname ${shq(params.hostname)}`, { rollback }),
        fileEditStep({ id: 'hosts', label: 'Point the name at this server in /etc/hosts', path: '/etc/hosts', content: hostsWithHostname(hardening.hosts.content, params.hostname), originalSha256: hardening.hosts.sha256, mode: '644', owner: 'root:root' })
      ],
      blocked: params.hostname === hardening.hostname ? precondition('That is already the host name.') : null
    })
  }
}

export const hardeningActions: ActionDefinition[] = [unattended, swap, timesync, timezone, hostname] as ActionDefinition[]
