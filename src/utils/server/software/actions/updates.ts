import type { ActionDefinition, ActionPlan, ServerFacts } from '@/types/server/core'
import { IDENTITY_PROBE } from '@/types/server/identity'
import { APT_ENV, APT_GET, assertPackageName } from '../../apt'
import { installedPackage } from '../packages'
import { blockedPlan, LONG_APT, okData, rootCommand, softwarePlan, unsupportedOsMessage } from '../planKit'
import { shellQuote } from '../sections'
import { PACKAGES_PROBE, UPDATES_PROBE, type PackagesFacts, type UpdatesFacts, type UpgradePackage } from '../types'
import { securityUpdates } from '../updates'
import { asRecord, matching, oneOf, SERVICE_UNIT, stringList } from '../validate'

const aptScript = (...commands: string[]): string => ['set -e', APT_ENV, ...commands, ''].join('\n')

function updatesOrBlock(title: string, facts: ServerFacts): UpdatesFacts | ActionPlan {
  const os = unsupportedOsMessage(facts)
  if (os) return blockedPlan(title, 'unsupported', os)
  const updates = okData<UpdatesFacts>(facts, UPDATES_PROBE)
  if (!updates) return blockedPlan(title, 'precondition', 'Updates have not been checked yet. Refresh the page and try again.')
  if (!updates.supported) return blockedPlan(title, 'unsupported', 'This server does not use apt, so updates cannot be managed here.')
  return updates
}

const isPlan = (value: UpdatesFacts | ActionPlan): value is ActionPlan => 'steps' in value

export const checkUpdatesAction: ActionDefinition<Record<string, never>> = {
  type: 'software.check-updates',
  area: 'software',
  needs: [IDENTITY_PROBE, UPDATES_PROBE],
  validate: () => ({}),
  plan(_params, facts) {
    const title = 'Check for updates'
    const updates = updatesOrBlock(title, facts)
    if (isPlan(updates)) return updates
    return softwarePlan(title, 'Download the latest package lists. Nothing is installed.', [rootCommand('update', 'Refresh package lists', aptScript(`${APT_GET} update`), { timeoutSeconds: 300 })])
  }
}

export type UpgradeParams = { mode: 'all' } | { mode: 'security' } | { mode: 'selected'; packages: string[] }

const UPGRADE_MODES = ['all', 'security', 'selected'] as const

function validateUpgrade(raw: unknown): UpgradeParams {
  const value = asRecord(raw)
  const mode = oneOf(value.mode, UPGRADE_MODES, 'upgrade mode')
  if (mode !== 'selected') return { mode }
  return { mode, packages: stringList(value.packages, assertPackageName) }
}

const onlyUpgrade = (names: string[]): string => `${APT_GET} install --only-upgrade --no-remove ${names.map(shellQuote).join(' ')}`

function upgradeWarnings(updates: UpdatesFacts, chosen: UpgradePackage[]): string[] {
  const warnings: string[] = []
  if (updates.held.length > 0) warnings.push(`Held packages stay at their current version: ${updates.held.join(', ')}.`)
  if (chosen.some((item) => /^linux-(image|headers|modules)/.test(item.name))) warnings.push('This includes a new kernel. The server needs a reboot to use it.')
  return warnings
}

function securityStep(packages: PackagesFacts | null, security: UpgradePackage[]) {
  const label = 'Install security updates'
  if (packages && installedPackage(packages, 'unattended-upgrades')) return rootCommand('upgrade', label, aptScript('unattended-upgrade -v'), LONG_APT)
  return rootCommand('upgrade', label, aptScript(onlyUpgrade(security.map((item) => item.name))), LONG_APT)
}

function selectedPackages(updates: UpdatesFacts, names: string[]): UpgradePackage[] | string {
  const unknown = names.filter((name) => !updates.packages.some((item) => item.name === name))
  if (unknown.length > 0) return `Not in the list of updates: ${unknown.join(', ')}. Check for updates and try again.`
  return updates.packages.filter((item) => names.includes(item.name))
}

export const upgradeAction: ActionDefinition<UpgradeParams> = {
  type: 'software.upgrade',
  area: 'software',
  needs: [IDENTITY_PROBE, UPDATES_PROBE, PACKAGES_PROBE],
  validate: validateUpgrade,
  plan(params, facts) {
    const title = params.mode === 'security' ? 'Install security updates' : params.mode === 'all' ? 'Install all updates' : 'Install selected updates'
    const updates = updatesOrBlock(title, facts)
    if (isPlan(updates)) return updates
    if (params.mode === 'all') {
      if (updates.packages.length === 0) return blockedPlan(title, 'precondition', 'Everything is up to date.')
      const step = rootCommand('upgrade', 'Install updates', aptScript(`${APT_GET} upgrade --with-new-pkgs`), LONG_APT)
      return softwarePlan(title, `Install ${updates.packages.length} updates. Never removes packages or changes the OS release.`, [step], upgradeWarnings(updates, updates.packages))
    }
    if (params.mode === 'security') {
      const security = securityUpdates(updates)
      if (security.length === 0) return blockedPlan(title, 'precondition', 'There are no security updates.')
      const step = securityStep(okData<PackagesFacts>(facts, PACKAGES_PROBE), security)
      return softwarePlan(title, `Install ${security.length} security updates.`, [step], upgradeWarnings(updates, security))
    }
    const chosen = selectedPackages(updates, params.packages)
    if (typeof chosen === 'string') return blockedPlan(title, 'precondition', chosen)
    const step = rootCommand('upgrade', 'Install selected updates', aptScript(onlyUpgrade(chosen.map((item) => item.name))), LONG_APT)
    return softwarePlan(title, `Install ${chosen.length} selected updates.`, [step], upgradeWarnings(updates, chosen))
  }
}

export interface RestartServicesParams {
  services: string[]
}

export const restartServicesAction: ActionDefinition<RestartServicesParams> = {
  type: 'software.restart-services',
  area: 'software',
  needs: [UPDATES_PROBE],
  validate: (raw) => ({ services: stringList(asRecord(raw).services, (item) => matching(item, SERVICE_UNIT, 'service')) }),
  plan(params, facts) {
    const title = 'Restart services'
    const updates = okData<UpdatesFacts>(facts, UPDATES_PROBE)
    const pending = updates?.needRestart.services ?? []
    const unknown = params.services.filter((name) => !pending.includes(name))
    if (unknown.length > 0) return blockedPlan(title, 'precondition', `These services do not need a restart: ${unknown.join(', ')}.`)
    const step = rootCommand('restart', 'Restart services', `systemctl restart ${params.services.map(shellQuote).join(' ')}\n`, { timeoutSeconds: 180 })
    return softwarePlan(title, `Restart ${params.services.length} services so they use the updated libraries.`, [step])
  }
}
