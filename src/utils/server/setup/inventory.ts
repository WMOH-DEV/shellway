import type { ProbeDefinition } from '@/types/server/core'
import type { SetupFiles, SetupInventory } from './types'

export const INVENTORY_PROBE = 'setup.inventory'

export const FILES_PROBE = 'setup.files'

export const SUDOERS_FILE = '/etc/sudoers.d/shellway-deploy'

export const SSHD_DROPIN = '/etc/ssh/sshd_config.d/00-shellway.conf'

export const FAIL2BAN_JAIL = '/etc/fail2ban/jail.d/shellway.local'

export const UNATTENDED_FILE = '/etc/apt/apt.conf.d/52shellway-unattended'

const MANAGED_FILES = [SUDOERS_FILE, SSHD_DROPIN, FAIL2BAN_JAIL, UNATTENDED_FILE]

const WATCHED_PACKAGES = [
  'nginx', 'apache2', "'php*-fpm'", 'mysql-server', 'mariadb-server', 'postgresql', "'postgresql-[0-9]*'", 'redis-server',
  'nodejs', 'supervisor', 'certbot', 'docker-ce', 'docker.io', 'ufw', 'fail2ban', 'unattended-upgrades'
]

const WATCHED_COMMANDS = ['composer', 'node', 'npm', 'pm2', 'snap', 'docker', 'certbot']

const INVENTORY_SCRIPT = [
  'set -- $SSH_CONNECTION',
  'echo "client=${1:-}"',
  'echo "port=${4:-}"',
  'echo "user=$(id -un)"',
  'echo "home=$HOME"',
  "awk '/^MemTotal:/ {print \"memKb=\" $2} /^SwapTotal:/ {print \"swapKb=\" $2}' /proc/meminfo",
  'if [ -s "$HOME/.nvm/nvm.sh" ]; then echo "nvm=1"; fi',
  'if [ -r "$HOME/.ssh/authorized_keys" ]; then echo "keys=$(grep -c -E \'^[^#[:space:]]\' "$HOME/.ssh/authorized_keys")"; fi',
  'if getent passwd deploy >/dev/null 2>&1; then echo "deployUser=1"; fi',
  'echo "installedAt=$(stat -c %Y /etc/machine-id 2>/dev/null)"',
  'echo "wwwSites=$(find /var/www -mindepth 1 -maxdepth 1 -type d ! -name html 2>/dev/null | wc -l)"',
  `for c in ${WATCHED_COMMANDS.join(' ')}; do if command -v "$c" >/dev/null 2>&1; then echo "cmd=$c"; fi; done`,
  'if [ -x /snap/bin/certbot ]; then echo "cmd=certbot"; fi',
  `dpkg-query -W -f='\${db:Status-Abbrev} \${Package}\\n' ${WATCHED_PACKAGES.join(' ')} 2>/dev/null | awk '$1 == "ii" {print "pkg=" $2}'`,
  'exit 0',
  ''
].join('\n')

const FILES_SCRIPT = [
  `for f in ${MANAGED_FILES.join(' ')}; do`,
  '  if [ -f "$f" ]; then echo "sha=$(sha256sum "$f" | cut -d" " -f1) $f"; fi',
  'done',
  'if command -v fail2ban-client >/dev/null 2>&1; then',
  "  fail2ban-client get sshd ignoreip 2>/dev/null | sed -n 's/^[|`]- *//p' | sed 's/^/ignore=/'",
  'fi',
  'exit 0',
  ''
].join('\n')

function keyValues(stdout: string): Map<string, string[]> {
  const values = new Map<string, string[]>()
  for (const line of stdout.split('\n')) {
    const at = line.indexOf('=')
    if (at <= 0) continue
    const key = line.slice(0, at).trim()
    values.set(key, [...(values.get(key) ?? []), line.slice(at + 1).trim()])
  }
  return values
}

const toInt = (value: string | undefined): number | null => {
  if (!value || !/^\d+$/.test(value)) return null
  return Number(value)
}

export function parseInventory(stdout: string): SetupInventory {
  const values = keyValues(stdout)
  const first = (key: string): string | undefined => values.get(key)?.[0] || undefined
  const port = toInt(first('port'))
  return {
    packages: [...new Set(values.get('pkg') ?? [])],
    commands: [...new Set(values.get('cmd') ?? [])],
    clientIp: first('client') ?? null,
    sshPort: port !== null && port > 0 && port < 65536 ? port : null,
    user: first('user') ?? '',
    home: first('home') ?? '',
    memoryBytes: (toInt(first('memKb')) ?? 0) * 1024,
    swapBytes: (toInt(first('swapKb')) ?? 0) * 1024,
    nvm: first('nvm') === '1',
    authorizedKeys: toInt(first('keys')) ?? 0,
    deployUserExists: first('deployUser') === '1',
    installedAt: toInt(first('installedAt')),
    wwwSites: toInt(first('wwwSites')) ?? 0
  }
}

export function parseFiles(stdout: string): SetupFiles {
  const values = keyValues(stdout)
  const hashes: Record<string, string> = {}
  for (const entry of values.get('sha') ?? []) {
    const [sha, path] = entry.split(' ')
    if (/^[0-9a-f]{64}$/.test(sha) && MANAGED_FILES.includes(path)) hashes[path] = sha
  }
  return { hashes, fail2banIgnore: (values.get('ignore') ?? []).filter(Boolean) }
}

export const inventoryProbe: ProbeDefinition<SetupInventory> = {
  id: INVENTORY_PROBE,
  area: 'setup',
  root: false,
  timeoutSeconds: 20,
  script: INVENTORY_SCRIPT,
  parse: parseInventory
}

export const filesProbe: ProbeDefinition<SetupFiles> = {
  id: FILES_PROBE,
  area: 'setup',
  root: true,
  timeoutSeconds: 20,
  script: FILES_SCRIPT,
  parse: parseFiles
}
