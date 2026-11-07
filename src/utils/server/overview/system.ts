import type { ProbeDefinition } from '@/types/server/core'
import { keyValueLines, toNumber } from './format'
import { SYSTEM_PROBE } from './ids'

export interface SystemState {
  webServers: string[]
  installedAt: number | null
  bootedAt: number | null
  now: number | null
}

const WEB_SERVERS = ['nginx', 'apache2', 'httpd', 'caddy', 'lighttpd']

const SYSTEM_SCRIPT = [
  'export LC_ALL=C PATH="$PATH:/usr/local/sbin:/usr/sbin:/sbin"',
  `for name in ${WEB_SERVERS.join(' ')}; do command -v "$name" >/dev/null 2>&1 && echo "web=$name"; done`,
  'echo "installed=$(stat -c %Y /etc/machine-id 2>/dev/null)"',
  'now=$(date +%s)',
  'echo "now=$now"',
  'up=$(cut -d. -f1 /proc/uptime 2>/dev/null)',
  '[ -n "$up" ] && echo "booted=$((now - up))"',
  'exit 0',
  ''
].join('\n')

export function parseSystem(stdout: string): SystemState {
  const values = keyValueLines(stdout)
  const webServers = stdout.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('web=')).map((line) => line.slice(4)).filter((name) => WEB_SERVERS.includes(name))
  const positive = (key: string) => {
    const value = toNumber(values.get(key))
    return value !== null && value > 0 ? value : null
  }
  return { webServers, installedAt: positive('installed'), bootedAt: positive('booted'), now: positive('now') }
}

export const systemProbe: ProbeDefinition<SystemState> = {
  id: SYSTEM_PROBE,
  area: 'overview',
  root: false,
  timeoutSeconds: 10,
  script: SYSTEM_SCRIPT,
  parse: parseSystem
}
