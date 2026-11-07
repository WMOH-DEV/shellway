import { newestFirst } from '@/utils/createSite/php'
import { decodeBase64, keyValues, sectionLines, splitSections, type OutputSection } from './sections'
import type { PhpFacts, PhpIniFile, PhpSite, PhpVersionFacts, ServiceState } from './types'

export const INI_KEYS = [
  'memory_limit',
  'upload_max_filesize',
  'post_max_size',
  'max_execution_time',
  'max_input_vars',
  'date.timezone',
  'opcache.enable',
  'opcache.memory_consumption'
] as const

export type IniKey = (typeof INI_KEYS)[number]

export const POOL_KEYS = ['pm', 'pm.max_children', 'pm.start_servers', 'pm.min_spare_servers', 'pm.max_spare_servers', 'pm.max_requests'] as const

export type PoolKey = (typeof POOL_KEYS)[number]

export const overridePath = (version: string): string => `/etc/php/${version}/fpm/conf.d/99-shellway.ini`

export const poolPath = (version: string): string => `/etc/php/${version}/fpm/pool.d/www.conf`

const fileDump = (path: string): string => `if [ -f "${path}" ]; then echo "sha=$(sha256sum "${path}" | cut -d' ' -f1)"; echo "b64=$(base64 -w0 "${path}")"; fi`

export const PHP_SCRIPT = `if [ ! -d /etc/php ]; then echo '@@none'; exit 0; fi
echo '@@cli'
readlink -f /etc/alternatives/php 2>/dev/null
echo '@@installable'
apt-cache pkgnames php 2>/dev/null | grep -E '^php[0-9]+\\.[0-9]+-fpm$' | sed -E 's/^php([0-9.]+)-fpm$/\\1/'
for d in /etc/php/*/; do
  v=$(basename "$d")
  case "$v" in [0-9].[0-9]|[0-9].[0-9][0-9]) ;; *) continue ;; esac
  echo "@@version $v"
  [ -x "/usr/sbin/php-fpm$v" ] && echo fpm=1
  [ -x "/usr/bin/php$v" ] && echo cli=1
  echo "fpm_state=$(systemctl is-active "php$v-fpm" 2>/dev/null)"
  echo "@@modules $v"
  [ -x "/usr/bin/php$v" ] && "php$v" -m 2>/dev/null
  echo "@@packages $v"
  dpkg-query -W -f='\${Package}\\t\${Status}\\n' "php$v-*" 2>/dev/null | awk -F'\\t' '$2=="install ok installed"{print $1}'
  echo "@@available $v"
  apt-cache pkgnames "php$v-" 2>/dev/null | sort
  echo "@@ini $v"
  if [ -x "/usr/bin/php$v" ] && [ -f "/etc/php/$v/fpm/php.ini" ]; then
    PHP_INI_SCAN_DIR="/etc/php/$v/fpm/conf.d" "php$v" -c "/etc/php/$v/fpm/php.ini" -r 'foreach (explode(",", "${INI_KEYS.join(',')}") as $k) { echo $k, "=", ini_get($k), PHP_EOL; }' 2>/dev/null
  fi
  echo "@@pool $v"
  ${fileDump('/etc/php/$v/fpm/pool.d/www.conf')}
  echo "@@override $v"
  ${fileDump('/etc/php/$v/fpm/conf.d/99-shellway.ini')}
done
echo '@@sites'
for f in /etc/nginx/sites-enabled/* /etc/apache2/sites-enabled/*; do
  [ -f "$f" ] || continue
  v=$(grep -oE 'php[0-9]+\\.[0-9]+-fpm\\.sock' "$f" 2>/dev/null | head -n 1 | sed -E 's/^php([0-9.]+)-fpm\\.sock$/\\1/')
  [ -n "$v" ] || continue
  root=$(sed -nE 's/^[[:space:]]*(root|DocumentRoot)[[:space:]]+"?([^";[:space:]]+).*/\\2/p' "$f" 2>/dev/null | head -n 1)
  dir=\${root%/public}
  ext=''
  if [ -n "$dir" ] && [ -r "$dir/composer.json" ]; then
    ext=$(grep -oE '"ext-[A-Za-z0-9_]+"' "$dir/composer.json" | tr -d '"' | sed 's/^ext-//' | sort -u | tr '\\n' ' ')
  fi
  echo "$v|$(basename "$f")|$ext"
done
exit 0
`

const MODULE_ALIASES: Record<string, string> = { 'zend opcache': 'opcache' }

const normalizeModule = (name: string): string => {
  const lower = name.trim().toLowerCase()
  return MODULE_ALIASES[lower] ?? lower
}

function parseModules(lines: string[]): string[] {
  return [...new Set(lines.filter((line) => !line.startsWith('[')).map(normalizeModule).filter(Boolean))].sort()
}

function parseFile(lines: string[]): PhpIniFile {
  const values = keyValues(lines)
  return { sha256: values.sha || null, content: decodeBase64(values.b64 ?? '') }
}

const POOL_LINE = /^\s*(pm(?:\.[a-z_]+)?)\s*=\s*(\S+)/

export function parsePoolSettings(content: string): Record<string, string> {
  const settings: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const match = POOL_LINE.exec(line)
    if (match && (POOL_KEYS as readonly string[]).includes(match[1])) settings[match[1]] = match[2]
  }
  return settings
}

const SERVICE_STATES: ServiceState[] = ['active', 'inactive', 'failed', 'activating']

const serviceState = (value: string | undefined): ServiceState => (SERVICE_STATES.includes(value as ServiceState) ? (value as ServiceState) : 'unknown')

function parseVersion(sections: OutputSection[], version: string): PhpVersionFacts {
  const values = keyValues(sectionLines(sections, 'version', version))
  const poolLines = sectionLines(sections, 'pool', version)
  const poolFile = poolLines.length > 0 ? parseFile(poolLines) : null
  const names = (name: string) => sectionLines(sections, name, version).map((line) => line.trim())
  return {
    version,
    fpm: values.fpm === '1',
    fpmState: serviceState(values.fpm_state),
    cli: values.cli === '1',
    modules: parseModules(sectionLines(sections, 'modules', version)),
    packages: names('packages'),
    available: names('available'),
    ini: keyValues(sectionLines(sections, 'ini', version)),
    pool: poolFile ? parsePoolSettings(poolFile.content) : {},
    poolFile,
    override: parseFile(sectionLines(sections, 'override', version))
  }
}

function parseSite(line: string): PhpSite | null {
  const [version, file, extensions = ''] = line.split('|')
  if (!version || !file) return null
  return { version, name: file.replace(/\.conf$/, ''), extensions: extensions.split(/\s+/).filter(Boolean).map((name) => name.toLowerCase()) }
}

const cliVersion = (lines: string[]): string | null => /php(\d+\.\d+)$/.exec(lines[0]?.trim() ?? '')?.[1] ?? null

export function parsePhp(stdout: string): PhpFacts {
  const sections = splitSections(stdout)
  const versions = newestFirst(sections.filter((section) => section.name === 'version').map((section) => section.arg)).map((version) => parseVersion(sections, version))
  const installed = versions.map((item) => item.version)
  return {
    installed: versions.length > 0,
    cliDefault: cliVersion(sectionLines(sections, 'cli')),
    versions,
    installable: newestFirst(sectionLines(sections, 'installable').map((line) => line.trim())).filter((version) => !installed.includes(version)),
    sites: sectionLines(sections, 'sites').map(parseSite).filter((site): site is PhpSite => site !== null)
  }
}

export const phpVersion = (facts: PhpFacts, version: string): PhpVersionFacts | undefined => facts.versions.find((item) => item.version === version)

export const sitesUsing = (facts: PhpFacts, version: string): PhpSite[] => facts.sites.filter((site) => site.version === version)
