import type { ActionDefinition, ActionPlan, ServerFacts } from '@/types/server/core'
import { IDENTITY_PROBE, type ServerIdentity } from '@/types/server/identity'
import { aptInstallScript, aptRemoveScript, assertPackageName } from '../../apt'
import { installRecipe, type ComponentId } from '../../install'
import { asOsFamilyOverride, withOsFamily } from '../../setup/overrides'
import type { OsFamilyOverride } from '../../settings/prefs'
import { CATALOG, catalogEntry, ownsPackage, rivalEntry } from '../catalog'
import { installedPackage } from '../packages'
import { phpVersion, sitesUsing } from '../php'
import { blockedPlan, LONG_APT, okData, rootCommand, softwarePlan, unsupportedOsMessage } from '../planKit'
import { PACKAGES_PROBE, PHP_PROBE, USAGE_PROBE, type CatalogEntry, type PackagesFacts, type PhpFacts, type UsageFacts } from '../types'
import { asRecord, assertPhpVersion, matching, oneOf } from '../validate'

export interface ComponentParams {
  component: ComponentId
  version?: string
}

export interface InstallParams extends ComponentParams {
  osFamily: OsFamilyOverride
}

const COMPONENTS = CATALOG.flatMap((entry) => (entry.component ? [entry.component] : []))

const REMOVABLE = CATALOG.flatMap((entry) => (entry.component && entry.removable ? [entry.component] : [])).concat('php')

const VERSION = /^\d{1,3}(\.\d{1,3}){0,2}$/

function validateComponent(raw: unknown, allowed: ComponentId[]): ComponentParams {
  const value = asRecord(raw)
  const component = oneOf(value.component, allowed, 'component')
  if (component === 'php') return { component, version: assertPhpVersion(String(value.version)) }
  return value.version === undefined ? { component } : { component, version: matching(value.version, VERSION, 'version') }
}

const validateInstall = (raw: unknown): InstallParams => ({
  ...validateComponent(raw, COMPONENTS),
  osFamily: asRecord(raw).osFamily === undefined ? 'auto' : asOsFamilyOverride(asRecord(raw).osFamily)
})

function withOverriddenOs(facts: ServerFacts, osFamily: OsFamilyOverride): ServerFacts {
  const identity = okData<ServerIdentity>(facts, IDENTITY_PROBE)
  if (!identity || osFamily === 'auto') return facts
  return { ...facts, [IDENTITY_PROBE]: { status: 'ok', data: { ...identity, os: withOsFamily(identity.os, osFamily) }, at: facts[IDENTITY_PROBE].at } }
}

const entryFor = (component: ComponentId): CatalogEntry => CATALOG.find((entry) => entry.component === component) as CatalogEntry

const installedNames = (entry: CatalogEntry, packages: PackagesFacts): string[] => packages.installed.filter((item) => ownsPackage(entry, item.name)).map((item) => item.name)

const describe = (params: ComponentParams): string => (params.version ? `${entryFor(params.component).name} ${params.version}` : entryFor(params.component).name)

function alreadyInstalled(params: ComponentParams, facts: ServerFacts): boolean {
  if (params.component === 'php') return Boolean(okData<PhpFacts>(facts, PHP_PROBE)?.versions.some((item) => item.version === params.version))
  const packages = okData<PackagesFacts>(facts, PACKAGES_PROBE)
  return packages !== null && installedNames(entryFor(params.component), packages).length > 0
}

function rivalBlock(params: ComponentParams, facts: ServerFacts): string | null {
  const rival = rivalEntry(params.component)
  const packages = okData<PackagesFacts>(facts, PACKAGES_PROBE)
  if (!rival || !packages || installedNames(rival, packages).length === 0) return null
  return `${rival.name} is already installed, and installing ${describe(params)} would remove it. Remove ${rival.name} first if you want to switch.`
}

export const installAction: ActionDefinition<InstallParams> = {
  type: 'software.install',
  area: 'software',
  needs: [IDENTITY_PROBE, PACKAGES_PROBE, PHP_PROBE],
  validate: validateInstall,
  plan(params, original) {
    const title = `Install ${describe(params)}`
    const facts = withOverriddenOs(original, params.osFamily)
    const os = unsupportedOsMessage(facts)
    if (os) return blockedPlan(title, 'unsupported', os)
    const identity = okData<ServerIdentity>(facts, IDENTITY_PROBE)
    if (!identity) return blockedPlan(title, 'precondition', 'The server OS has not been detected yet. Refresh and try again.')
    if (alreadyInstalled(params, facts)) return blockedPlan(title, 'precondition', `${describe(params)} is already installed.`)
    const rival = rivalBlock(params, facts)
    if (rival) return blockedPlan(title, 'precondition', rival)
    const recipe = installRecipe({ component: params.component, version: params.version }, identity.os)
    if (!recipe.supported) return blockedPlan(title, 'unsupported', recipe.reason)
    return softwarePlan(title, `Install ${describe(params)} from ${recipe.source}.`, recipe.steps)
  }
}

function databaseBlock(names: string[] | null, engine: string): string | null {
  if (names === null) return `Could not check which databases ${engine} holds, so it was not removed.`
  return names.length > 0 ? `${engine} still holds ${names.length} databases: ${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}.` : null
}

function dependencyBlock(component: ComponentId, packages: PackagesFacts, usage: UsageFacts | null): string | null {
  if (component === 'nginx' && packages.siteCounts.nginx > 0) return `nginx serves ${packages.siteCounts.nginx} sites. Remove those sites first.`
  if (component === 'apache' && packages.siteCounts.apache > 0) return `Apache serves ${packages.siteCounts.apache} sites. Remove those sites first.`
  if (component === 'mysql' || component === 'mariadb') return databaseBlock(usage?.mysqlDatabases ?? null, entryFor(component).name)
  if (component === 'postgresql') return databaseBlock(usage?.postgresDatabases ?? null, 'PostgreSQL')
  return null
}

const KEEPS_DATA = 'Settings and data stay on disk.'

function removePhpPlan(version: string, facts: ServerFacts): ActionPlan {
  const title = `Remove PHP ${version}`
  const php = okData<PhpFacts>(facts, PHP_PROBE)
  const target = php ? phpVersion(php, version) : undefined
  if (!php || !target) return blockedPlan(title, 'precondition', `PHP ${version} is not installed.`)
  const sites = sitesUsing(php, version)
  if (sites.length > 0) return blockedPlan(title, 'precondition', `PHP ${version} is used by ${sites.map((site) => site.name).join(', ')}. Move those sites to another version first.`)
  if (target.packages.length === 0) return blockedPlan(title, 'precondition', `No PHP ${version} packages were found.`)
  const warnings = php.cliDefault === version ? [`PHP ${version} is the command line default. Another version takes over.`] : []
  return softwarePlan(title, `Remove ${target.packages.length} PHP ${version} packages. ${KEEPS_DATA}`, [rootCommand('remove', title, aptRemoveScript(target.packages), LONG_APT)], warnings)
}

export const removeAction: ActionDefinition<ComponentParams> = {
  type: 'software.remove',
  area: 'software',
  needs: [IDENTITY_PROBE, PACKAGES_PROBE, PHP_PROBE, USAGE_PROBE],
  validate: (raw) => validateComponent(raw, REMOVABLE),
  plan(params, facts) {
    const title = `Remove ${describe(params)}`
    const os = unsupportedOsMessage(facts)
    if (os) return blockedPlan(title, 'unsupported', os)
    if (params.component === 'php') return removePhpPlan(params.version as string, facts)
    const packages = okData<PackagesFacts>(facts, PACKAGES_PROBE)
    if (!packages) return blockedPlan(title, 'precondition', 'Installed software has not been checked yet.')
    const names = installedNames(entryFor(params.component), packages)
    if (names.length === 0) return blockedPlan(title, 'precondition', `${describe(params)} is not installed.`)
    const dependency = dependencyBlock(params.component, packages, okData<UsageFacts>(facts, USAGE_PROBE))
    if (dependency) return blockedPlan(title, 'precondition', dependency)
    return softwarePlan(title, `Remove ${names.join(', ')}. ${KEEPS_DATA}`, [rootCommand('remove', title, aptRemoveScript(names), LONG_APT)])
  }
}

export interface AptInstallParams {
  package: string
}

export const aptInstallAction: ActionDefinition<AptInstallParams> = {
  type: 'software.apt-install',
  area: 'software',
  needs: [IDENTITY_PROBE, PACKAGES_PROBE],
  validate: (raw) => ({ package: assertPackageName(String(asRecord(raw).package)) }),
  plan(params, facts) {
    const title = `Install ${params.package}`
    const os = unsupportedOsMessage(facts)
    if (os) return blockedPlan(title, 'unsupported', os)
    const packages = okData<PackagesFacts>(facts, PACKAGES_PROBE)
    if (packages && !packages.supported) return blockedPlan(title, 'unsupported', 'This server does not use apt.')
    if (packages && installedPackage(packages, params.package)) return blockedPlan(title, 'precondition', `${params.package} is already installed.`)
    return softwarePlan(title, `Install the ${params.package} package with apt.`, [rootCommand('install', title, aptInstallScript([params.package]), LONG_APT)])
  }
}

export const removableComponent = (id: string): boolean => {
  const entry = catalogEntry(id)
  return Boolean(entry?.component && (REMOVABLE as string[]).includes(entry.component))
}
