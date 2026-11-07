import { blocksTagged, blockText, hasTag, splitBlocks } from './shell'
import type { Pm2App, Pm2Facts, Pm2Status } from './types'

const STATUSES: readonly Pm2Status[] = ['online', 'stopping', 'stopped', 'launching', 'errored', 'one-launch-status']
const SEVERITY: Record<Pm2Status, number> = { errored: 5, stopped: 4, stopping: 3, launching: 2, 'one-launch-status': 1, online: 0, unknown: 1 }

interface JlistEntry {
  name?: unknown
  pm2_env?: {
    status?: unknown
    restart_time?: unknown
    pm_uptime?: unknown
    pm_cwd?: unknown
    pm_exec_path?: unknown
    args?: unknown
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const statusOf = (value: unknown): Pm2Status => (STATUSES.includes(value as Pm2Status) ? (value as Pm2Status) : 'unknown')
const argsOf = (value: unknown): string => (Array.isArray(value) ? value.map(String).join(' ') : text(value))

function readJlist(raw: string): JlistEntry[] {
  const start = raw.search(/^\[\s*[{\]]/m)
  const end = raw.lastIndexOf(']')
  if (start < 0 || end < start) return []
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1))
    return Array.isArray(parsed) ? (parsed as JlistEntry[]) : []
  } catch {
    return []
  }
}

function appOf(user: string, entry: JlistEntry): Pm2App {
  const env = entry.pm2_env ?? {}
  const uptime = count(env.pm_uptime)
  return {
    user,
    name: text(entry.name),
    status: statusOf(env.status),
    instances: 1,
    restarts: count(env.restart_time),
    startedAt: uptime > 0 ? uptime : null,
    cwd: text(env.pm_cwd),
    script: text(env.pm_exec_path),
    args: argsOf(env.args)
  }
}

function merge(existing: Pm2App, next: Pm2App): Pm2App {
  return {
    ...existing,
    status: SEVERITY[next.status] > SEVERITY[existing.status] ? next.status : existing.status,
    instances: existing.instances + 1,
    restarts: existing.restarts + next.restarts,
    startedAt: existing.startedAt === null || next.startedAt === null ? existing.startedAt ?? next.startedAt : Math.min(existing.startedAt, next.startedAt)
  }
}

export function groupApps(apps: Pm2App[]): Pm2App[] {
  const grouped = new Map<string, Pm2App>()
  for (const app of apps) {
    const key = `${app.user}\n${app.name}`
    const existing = grouped.get(key)
    grouped.set(key, existing ? merge(existing, app) : app)
  }
  return [...grouped.values()]
}

export function parsePm2(stdout: string): Pm2Facts {
  const blocks = splitBlocks(stdout)
  if (hasTag(blocks, 'missing')) return { installed: false, users: [], apps: [] }
  const lists = blocksTagged(blocks, 'pm2')
  const apps = lists.flatMap((block) => readJlist(blockText(block)).map((entry) => appOf(block.args, entry)))
  return { installed: true, users: lists.map((block) => block.args), apps: groupApps(apps.filter((app) => app.name !== '')) }
}

const LIST = `p="$HOME/.pm2/pm2.pid"; [ -f "$p" ] && kill -0 "$(cat "$p")" 2>/dev/null && pm2 jlist 2>/dev/null`

export const PM2_SCRIPT = `if ! command -v pm2 >/dev/null 2>&1; then echo '@@missing'; exit 0; fi
self=$(id -un)
echo "@@pm2 $self"
sh -c '${LIST}' | head -c 4000000
echo
echo '@@end'
if [ "$(id -u)" -eq 0 ] || sudo -n true 2>/dev/null; then
  owners=$(sudo -n sh -c 'for d in /root /home/*; do [ -d "$d/.pm2" ] && stat -c %U "$d"; done' 2>/dev/null | sort -u | head -n 8)
  for u in $owners; do
    [ "$u" = "$self" ] && continue
    echo "@@pm2 $u"
    sudo -n -u "$u" -H sh -c '${LIST}' | head -c 4000000
    echo
    echo '@@end'
  done
fi
`
