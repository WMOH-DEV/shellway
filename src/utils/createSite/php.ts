import type { DatabaseEngine, PhpTools } from '@/types/createSite'
import { EXIT_REFUSED } from '../ssl/originCa/exitCodes'
import { assertPhpVersion } from './validate'

export const REQUIRED_PHP_SUFFIXES = ['fpm', 'cli', 'mbstring', 'xml', 'curl', 'zip']

export const DRIVER_SUFFIXES: Record<DatabaseEngine, string> = { mysql: 'mysql', postgresql: 'pgsql', sqlite: 'sqlite3' }

const NEW_PHP_SUFFIXES = [...REQUIRED_PHP_SUFFIXES, 'bcmath', 'intl', ...Object.values(DRIVER_SUFFIXES)]

const OLDEST_INSTALLABLE = '8.2'

const VERSION = /^\d\.\d{1,2}$/

const parts = (version: string): number[] => version.split('.').map(Number)

export function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor] = parts(a)
  const [bMajor, bMinor] = parts(b)
  return aMajor - bMajor || aMinor - bMinor
}

export const newestFirst = (versions: string[]): string[] =>
  [...new Set(versions.filter((version) => VERSION.test(version)))].sort((a, b) => compareVersions(b, a))

export function installableVersions(candidates: string[], installed: string[]): string[] {
  return newestFirst(candidates).filter((version) => !installed.includes(version) && compareVersions(version, OLDEST_INSTALLABLE) >= 0)
}

const packagesFor = (version: string, suffixes: string[]): string[] => suffixes.map((suffix) => `php${assertPhpVersion(version)}-${suffix}`)

export const requiredPhpPackages = (version: string): string[] => packagesFor(version, REQUIRED_PHP_SUFFIXES)

export const newPhpPackages = (version: string): string[] => packagesFor(version, NEW_PHP_SUFFIXES)

export type PhpNeed = { kind: 'none' } | { kind: 'install'; packages: string[] } | { kind: 'add'; packages: string[] } | { kind: 'unavailable' }

function missingDriver(php: PhpTools, version: string, engine: DatabaseEngine | null): string[] {
  const drivers = php.drivers[version]
  if (engine === null || drivers === undefined || drivers.includes(DRIVER_SUFFIXES[engine])) return []
  return packagesFor(version, [DRIVER_SUFFIXES[engine]])
}

export function phpNeed(php: PhpTools, version: string, engine: DatabaseEngine | null = null): PhpNeed {
  if (php.installed.includes(version)) {
    const missing = [...(php.missingPackages[version] ?? []), ...missingDriver(php, version, engine)]
    return missing.length === 0 ? { kind: 'none' } : { kind: 'add', packages: missing }
  }
  return php.installable.includes(version) ? { kind: 'install', packages: newPhpPackages(version) } : { kind: 'unavailable' }
}

export function installPhpScript(version: string, packages: string[]): string {
  const wanted = new Set(newPhpPackages(version))
  const names = packages.filter((name) => wanted.has(name))
  return [
    'set -e',
    'export DEBIAN_FRONTEND=noninteractive',
    'apt-get -o DPkg::Lock::Timeout=120 update',
    `apt-get -o DPkg::Lock::Timeout=120 install -y --no-remove ${names.join(' ')}`,
    `if command -v systemctl >/dev/null 2>&1; then systemctl enable --now php${assertPhpVersion(version)}-fpm; fi`,
    ''
  ].join('\n')
}

const COMPOSER_INSTALLER = 'https://getcomposer.org/installer'
const COMPOSER_SIGNATURE = 'https://composer.github.io/installer.sig'

export function installComposerScript(version: string): string {
  const php = `php${assertPhpVersion(version)}`
  return [
    'set -e',
    "if command -v composer >/dev/null 2>&1; then echo 'composer is already installed.'; exit 0; fi",
    `php=${php}; command -v "$php" >/dev/null 2>&1 || php=php`,
    'work=$(mktemp -d)',
    'trap \'rm -rf "$work"\' EXIT',
    `expected=$("$php" -r "echo trim(file_get_contents('${COMPOSER_SIGNATURE}'));")`,
    `"$php" -r "copy('${COMPOSER_INSTALLER}', '$work/composer-setup.php');"`,
    `actual=$("$php" -r "echo hash_file('sha384', '$work/composer-setup.php');")`,
    'if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then',
    "  echo 'The composer installer did not match its published checksum, so it was not run.' >&2",
    `  exit ${EXIT_REFUSED}`,
    'fi',
    '"$php" "$work/composer-setup.php" --quiet --install-dir=/usr/local/bin --filename=composer',
    ''
  ].join('\n')
}

const LEADING_PHP = /^php /
const LEADING_COMPOSER = /^composer /

export function pinPhpVersion(command: string, version: string): string {
  const php = `php${assertPhpVersion(version)}`
  return command.replace(LEADING_PHP, `${php} `).replace(LEADING_COMPOSER, `${php} "$(command -v composer)" `)
}
