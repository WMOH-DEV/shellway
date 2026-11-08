import type { PhpSite, PhpVersionFacts } from './types'

const NOT_EXTENSIONS = new Set(['cli', 'fpm', 'common', 'cgi', 'dev', 'phpdbg', 'embed', 'dbg', 'opcache', 'readline'])

const PACKAGE_FOR: Record<string, string> = {
  pdo_mysql: 'mysql',
  mysqli: 'mysql',
  mysqlnd: 'mysql',
  pdo_pgsql: 'pgsql',
  pdo_sqlite: 'sqlite3',
  sqlite: 'sqlite3',
  simplexml: 'xml',
  dom: 'xml',
  xmlwriter: 'xml',
  xmlreader: 'xml'
}

export interface MissingExtension {
  extension: string
  packageSuffix: string | null
  sites: string[]
}

export interface ExtensionView {
  installed: string[]
  missing: MissingExtension[]
  available: string[]
}

const suffixOf = (version: string, name: string): string | null => (name.startsWith(`php${version}-`) ? name.slice(`php${version}-`.length) : null)

const isExtensionSuffix = (suffix: string): boolean => !NOT_EXTENSIONS.has(suffix) && !suffix.endsWith('-dbgsym')

function suffixes(version: string, names: string[]): string[] {
  return names.map((name) => suffixOf(version, name)).filter((suffix): suffix is string => suffix !== null && isExtensionSuffix(suffix))
}

function missingExtensions(target: PhpVersionFacts, sites: PhpSite[], available: string[]): MissingExtension[] {
  const loaded = new Set(target.modules)
  const needed = new Map<string, string[]>()
  for (const site of sites) {
    for (const extension of site.extensions) {
      if (loaded.has(extension)) continue
      needed.set(extension, [...(needed.get(extension) ?? []), site.name])
    }
  }
  return [...needed].map(([extension, users]) => {
    const suffix = PACKAGE_FOR[extension] ?? extension
    return { extension, packageSuffix: available.includes(suffix) ? suffix : null, sites: users }
  })
}

export function extensionView(target: PhpVersionFacts, sites: PhpSite[]): ExtensionView {
  const installed = suffixes(target.version, target.packages).sort()
  const available = suffixes(target.version, target.available).filter((suffix) => !installed.includes(suffix)).sort()
  return { installed, missing: missingExtensions(target, sites, available), available }
}

export function changedValues<K extends string>(original: Partial<Record<K, string>>, edited: Partial<Record<K, string>>): Partial<Record<K, string>> {
  return Object.fromEntries(Object.entries(edited).filter(([key, value]) => value !== '' && value !== original[key as K])) as Partial<Record<K, string>>
}
