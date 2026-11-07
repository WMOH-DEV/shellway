import type { ActionDefinition, ActionPlan, ActionStep, ServerFacts } from '@/types/server/core'
import { IDENTITY_PROBE } from '@/types/server/identity'
import { aptInstallScript, aptRemoveScript } from '../../apt'
import { fileEditStep } from '../../fileEdit'
import { overridePath, phpVersion, poolPath, sitesUsing, type IniKey, type PoolKey } from '../php'
import { blockedPlan, changedLines, LONG_APT, okData, rootCommand, setDirectives, softwarePlan, unsupportedOsMessage } from '../planKit'
import { PHP_PROBE, type PhpFacts, type PhpVersionFacts } from '../types'
import { asRecord, assertPhpVersion, EXTENSION, iniSettings, matching, oneOf, poolProblem, poolSettings } from '../validate'

const fpmUnit = (version: string): string => `php${version}-fpm`

const reloadCommand = (version: string): string => `systemctl reload ${fpmUnit(version)}`

const fpmTest = (version: string): string => `php-fpm${version} -t`

type VersionLookup = { target: PhpVersionFacts; php: PhpFacts } | ActionPlan

function versionOrBlock(title: string, facts: ServerFacts, version: string): VersionLookup {
  const os = unsupportedOsMessage(facts)
  if (os) return blockedPlan(title, 'unsupported', os)
  const php = okData<PhpFacts>(facts, PHP_PROBE)
  if (!php) return blockedPlan(title, 'precondition', 'PHP has not been checked yet. Refresh and try again.')
  const target = phpVersion(php, version)
  if (!target) return blockedPlan(title, 'precondition', `PHP ${version} is not installed.`)
  return { target, php }
}

const isPlan = (value: VersionLookup): value is ActionPlan => 'steps' in value

function requireFpm(title: string, target: PhpVersionFacts): ActionPlan | null {
  return target.fpm ? null : blockedPlan(title, 'precondition', `PHP ${target.version} FPM is not installed.`)
}

const reloadStep = (version: string): ActionStep => rootCommand('reload', `Reload ${fpmUnit(version)}`, `${reloadCommand(version)}\n`)

export interface PhpExtensionParams {
  version: string
  extension: string
  op: 'install' | 'remove'
}

function extensionBlock(params: PhpExtensionParams, php: PhpFacts, target: PhpVersionFacts, packageName: string): string | null {
  if (params.op === 'install') {
    if (target.packages.includes(packageName)) return `${packageName} is already installed.`
    return target.available.includes(packageName) ? null : `${packageName} is not available from the package sources on this server.`
  }
  if (!target.packages.includes(packageName)) return `${packageName} is not installed.`
  const users = sitesUsing(php, params.version).filter((site) => site.extensions.includes(params.extension))
  return users.length > 0 ? `${users.map((site) => site.name).join(', ')} needs ${params.extension}.` : null
}

export const phpExtensionAction: ActionDefinition<PhpExtensionParams> = {
  type: 'software.php-extension',
  area: 'software',
  needs: [IDENTITY_PROBE, PHP_PROBE],
  validate(raw) {
    const value = asRecord(raw)
    return { version: assertPhpVersion(String(value.version)), extension: matching(value.extension, EXTENSION, 'extension'), op: oneOf(value.op, ['install', 'remove'] as const, 'operation') }
  },
  plan(params, facts) {
    const packageName = `php${params.version}-${params.extension}`
    const title = `${params.op === 'install' ? 'Add' : 'Remove'} ${params.extension} for PHP ${params.version}`
    const lookup = versionOrBlock(title, facts, params.version)
    if (isPlan(lookup)) return lookup
    const block = extensionBlock(params, lookup.php, lookup.target, packageName)
    if (block) return blockedPlan(title, 'precondition', block)
    const script = params.op === 'install' ? aptInstallScript([packageName]) : aptRemoveScript([packageName])
    const steps = [rootCommand('package', title, script, LONG_APT), ...(lookup.target.fpm ? [reloadStep(params.version)] : [])]
    return softwarePlan(title, `${params.op === 'install' ? 'Install' : 'Remove'} ${packageName}${lookup.target.fpm ? ' and reload PHP-FPM' : ''}.`, steps)
  }
}

export interface PhpVersionParams {
  version: string
}

const validateVersion = (raw: unknown): PhpVersionParams => ({ version: assertPhpVersion(String(asRecord(raw).version)) })

export const phpCliDefaultAction: ActionDefinition<PhpVersionParams> = {
  type: 'software.php-cli-default',
  area: 'software',
  needs: [IDENTITY_PROBE, PHP_PROBE],
  validate: validateVersion,
  plan(params, facts) {
    const title = `Make PHP ${params.version} the command line default`
    const lookup = versionOrBlock(title, facts, params.version)
    if (isPlan(lookup)) return lookup
    if (!lookup.target.cli) return blockedPlan(title, 'precondition', `PHP ${params.version} CLI is not installed.`)
    if (lookup.php.cliDefault === params.version) return blockedPlan(title, 'precondition', `PHP ${params.version} is already the default.`)
    const step = rootCommand('alternative', title, `update-alternatives --set php /usr/bin/php${params.version}\n`)
    const plan = softwarePlan(title, `The php command will run PHP ${params.version}. Sites keep their own version.`, [step])
    const previous = lookup.php.cliDefault
    return previous ? { ...plan, undo: { type: 'software.php-cli-default', params: { version: previous } } } : plan
  }
}

export const opcacheResetAction: ActionDefinition<PhpVersionParams> = {
  type: 'software.opcache-reset',
  area: 'software',
  needs: [IDENTITY_PROBE, PHP_PROBE],
  validate: validateVersion,
  plan(params, facts) {
    const title = `Clear OPcache for PHP ${params.version}`
    const lookup = versionOrBlock(title, facts, params.version)
    if (isPlan(lookup)) return lookup
    return requireFpm(title, lookup.target) ?? softwarePlan(title, 'Reloading PHP-FPM clears the OPcache without dropping requests.', [reloadStep(params.version)])
  }
}

export interface PhpIniParams {
  version: string
  values: Partial<Record<IniKey, string>>
}

export const phpIniAction: ActionDefinition<PhpIniParams> = {
  type: 'software.php-ini',
  area: 'software',
  needs: [IDENTITY_PROBE, PHP_PROBE],
  validate(raw) {
    const value = asRecord(raw)
    return { version: assertPhpVersion(String(value.version)), values: iniSettings(value.values) }
  },
  plan(params, facts) {
    const title = `Change php.ini for PHP ${params.version} FPM`
    const lookup = versionOrBlock(title, facts, params.version)
    if (isPlan(lookup)) return lookup
    const noFpm = requireFpm(title, lookup.target)
    if (noFpm) return noFpm
    const { override } = lookup.target
    const content = setDirectives(override.content, params.values as Record<string, string>)
    const diff = changedLines(override.content, content)
    if (diff === '') return blockedPlan(title, 'precondition', 'These values are already set.')
    const step = fileEditStep({
      id: 'ini',
      label: `Write ${overridePath(params.version)}`,
      path: overridePath(params.version),
      content,
      originalSha256: override.sha256,
      mode: '0644',
      owner: 'root:root',
      test: fpmTest(params.version),
      reload: reloadCommand(params.version),
      diff
    })
    return softwarePlan(title, 'Shellway keeps its settings in one override file, so php.ini itself stays untouched. A backup is kept.', [step])
  }
}

export interface PhpPoolParams {
  version: string
  settings: Partial<Record<PoolKey, string>>
}

export const phpFpmPoolAction: ActionDefinition<PhpPoolParams> = {
  type: 'software.php-fpm-pool',
  area: 'software',
  needs: [IDENTITY_PROBE, PHP_PROBE],
  validate(raw) {
    const value = asRecord(raw)
    return { version: assertPhpVersion(String(value.version)), settings: poolSettings(value.settings) }
  },
  plan(params, facts) {
    const title = `Change the PHP ${params.version} FPM pool`
    const lookup = versionOrBlock(title, facts, params.version)
    if (isPlan(lookup)) return lookup
    const { poolFile, pool } = lookup.target
    if (!poolFile?.sha256) return blockedPlan(title, 'precondition', `${poolPath(params.version)} was not found.`)
    const problem = poolProblem({ ...pool, ...params.settings })
    if (problem) return blockedPlan(title, 'precondition', problem)
    const content = setDirectives(poolFile.content, params.settings as Record<string, string>)
    const diff = changedLines(poolFile.content, content)
    if (diff === '') return blockedPlan(title, 'precondition', 'These values are already set.')
    const step = fileEditStep({
      id: 'pool',
      label: `Write ${poolPath(params.version)}`,
      path: poolPath(params.version),
      content,
      originalSha256: poolFile.sha256,
      mode: '0644',
      owner: 'root:root',
      test: fpmTest(params.version),
      reload: reloadCommand(params.version),
      diff
    })
    return softwarePlan(title, 'Only the changed lines are rewritten. A backup is kept and restored if the test fails.', [step])
  }
}
