import type { ServerTools } from '../../../src/types/createSite'
import type { ServerFacts } from '../../../src/types/ssl'
import { parseModules } from '../../../src/utils/webServer/apache/vhosts'
import { shellEscape } from '../../utils/shellEscape'
import type { RemoteExec } from '../deploy/DeployService'

const TOOLS_TIMEOUT_MS = 30_000

export const TOOLS_SCRIPT = `has() { command -v "$1" >/dev/null 2>&1 && echo 1 || echo 0; }
php=''
for v in 8.4 8.3 8.2 8.1 8.0 7.4; do
  if command -v "php-fpm$v" >/dev/null 2>&1 || [ -x "/usr/sbin/php-fpm$v" ]; then php=$v; break; fi
done
if [ -z "$php" ] && { command -v php-fpm >/dev/null 2>&1 || [ -x /usr/sbin/php-fpm ]; }; then
  php=$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;' 2>/dev/null)
fi
echo "php=$php"
echo "composer=$(has composer)"
echo "node=$(node --version 2>/dev/null)"
echo "pm2=$(has pm2)"
echo "docker=$(has docker)"
dir=/var/www; [ -d "$dir" ] || dir=/
echo "disk=$(df -Pk "$dir" 2>/dev/null | awk 'NR==2 {print $4}')"
`

const field = (text: string, name: string): string => text.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim() ?? ''

export function parseTools(text: string, apacheModules: string[]): ServerTools {
  const php = field(text, 'php')
  const node = field(text, 'node').match(/^v?(\d+)/)?.[1] ?? null
  const diskKb = Number(field(text, 'disk'))
  return {
    phpFpm: /^\d\.\d{1,2}$/.test(php) ? php : null,
    composer: field(text, 'composer') === '1',
    node,
    pm2: field(text, 'pm2') === '1',
    docker: field(text, 'docker') === '1',
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
