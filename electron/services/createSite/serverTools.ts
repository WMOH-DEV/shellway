import type { PhpTools, ServerTools } from '../../../src/types/createSite'
import { DRIVER_SUFFIXES, REQUIRED_PHP_SUFFIXES, installableVersions, newestFirst, requiredPhpPackages } from '../../../src/utils/createSite/php'
import type { ServerFacts } from '../../../src/types/ssl'
import { parseModules } from '../../../src/utils/webServer/apache/vhosts'
import { shellEscape } from '../../utils/shellEscape'
import type { RemoteExec } from '../deploy/DeployService'

const TOOLS_TIMEOUT_MS = 30_000

export const TOOLS_SCRIPT = `has() { command -v "$1" >/dev/null 2>&1 && echo 1 || echo 0; }
php=''
for f in /usr/sbin/php-fpm[0-9]* /usr/bin/php-fpm[0-9]*; do
  [ -x "$f" ] && php="$php \${f##*php-fpm}"
done
if [ -z "$php" ] && { command -v php-fpm >/dev/null 2>&1 || [ -x /usr/sbin/php-fpm ]; }; then
  php=$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;' 2>/dev/null)
fi
echo "php=$php"
if command -v apt-cache >/dev/null 2>&1 && command -v dpkg-query >/dev/null 2>&1; then
  echo "php_installable=$(apt-cache search --names-only '^php[0-9]+\\.[0-9]+-fpm$' 2>/dev/null | sed -n 's/^php\\([0-9]*\\.[0-9]*\\)-fpm .*/\\1/p' | tr '\\n' ' ')"
  for v in $php; do
    missing=''
    for p in ${REQUIRED_PHP_SUFFIXES.join(' ')}; do
      dpkg-query -W -f='\${Status}' "php$v-$p" 2>/dev/null | grep -q 'ok installed' || missing="$missing php$v-$p"
    done
    echo "php_missing_$v=$missing"
    drivers=''
    for p in ${Object.values(DRIVER_SUFFIXES).join(' ')}; do
      dpkg-query -W -f='\${Status}' "php$v-$p" 2>/dev/null | grep -q 'ok installed' && drivers="$drivers $p"
    done
    echo "php_drivers_$v=$drivers"
  done
fi
echo "composer=$(has composer)"
echo "node=$(node --version 2>/dev/null)"
echo "pm2=$(has pm2)"
if command -v systemctl >/dev/null 2>&1 && systemctl is-enabled "pm2-$(id -un)" >/dev/null 2>&1; then echo pm2_startup=1; else echo pm2_startup=0; fi
echo "docker=$(has docker)"
if [ -x /usr/sbin/mysqld ] || [ -x /usr/sbin/mariadbd ] || command -v mysqld >/dev/null 2>&1 || command -v mariadbd >/dev/null 2>&1; then echo db_mysql=1; else echo db_mysql=0; fi
if command -v pg_lsclusters >/dev/null 2>&1 || command -v postgres >/dev/null 2>&1 || ls /usr/lib/postgresql/*/bin/postgres >/dev/null 2>&1; then echo db_postgresql=1; else echo db_postgresql=0; fi
dir=/var/www; [ -d "$dir" ] || dir=/
echo "disk=$(df -Pk "$dir" 2>/dev/null | awk 'NR==2 {print $4}')"
`

const field = (text: string, name: string): string => text.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim() ?? ''

const words = (text: string): string[] => text.split(/\s+/).filter(Boolean)

const KNOWN_DRIVERS = new Set(Object.values(DRIVER_SUFFIXES))

const hasField = (text: string, name: string): boolean => new RegExp(`^${name}=`, 'm').test(text)

function parsePhp(text: string): PhpTools {
  const installed = newestFirst(words(field(text, 'php')))
  const versionKey = (prefix: string, version: string): string => `${prefix}_${version.replace('.', '\\.')}`
  const missingPackages = Object.fromEntries(installed.map((version) => {
    const allowed = new Set(requiredPhpPackages(version))
    return [version, words(field(text, versionKey('php_missing', version))).filter((name) => allowed.has(name))]
  }))
  const drivers = Object.fromEntries(installed
    .filter((version) => hasField(text, versionKey('php_drivers', version)))
    .map((version) => [version, words(field(text, versionKey('php_drivers', version))).filter((name) => KNOWN_DRIVERS.has(name))]))
  return { installed, installable: installableVersions(words(field(text, 'php_installable')), installed), missingPackages, drivers }
}

export function parseTools(text: string, apacheModules: string[]): ServerTools {
  const node = field(text, 'node').match(/^v?(\d+)/)?.[1] ?? null
  const diskKb = Number(field(text, 'disk'))
  return {
    php: parsePhp(text),
    composer: field(text, 'composer') === '1',
    node,
    pm2: field(text, 'pm2') === '1',
    pm2Startup: field(text, 'pm2_startup') === '1',
    docker: field(text, 'docker') === '1',
    databases: { mysql: field(text, 'db_mysql') === '1', postgresql: field(text, 'db_postgresql') === '1' },
    apacheModules,
    freeDiskBytes: Number.isFinite(diskKb) ? diskKb * 1024 : 0
  }
}

async function apacheModules(exec: RemoteExec, facts: ServerFacts): Promise<string[]> {
  const path = facts.paths.apache
  if (!path) return []
  const sudo = facts.sudo.apache || facts.sudo.full ? 'sudo -n ' : ''
  const listed = await exec(`${sudo}${shellEscape(path)} -M`, { timeoutMs: TOOLS_TIMEOUT_MS })
  return listed.code === 0 ? parseModules(`${listed.stdout}\n${listed.stderr}`) : []
}

export async function detectTools(exec: RemoteExec, facts: ServerFacts): Promise<ServerTools> {
  const [found, modules] = await Promise.all([exec('sh -s', { stdin: TOOLS_SCRIPT, timeoutMs: TOOLS_TIMEOUT_MS }), apacheModules(exec, facts)])
  return parseTools(found.stdout, modules)
}
