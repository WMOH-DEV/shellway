import { shellQuote, splitSections, type OutputSection } from './sections'
import type { Pm2App, Pm2Data, Pm2User } from './types'

export const LOAD_NODE = `[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
PATH="$PATH:/usr/local/bin:$HOME/.npm-global/bin:$HOME/.local/bin"`

const PROJECT_JLIST = `node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s.slice(Math.max(0,s.search(/^\\[[{\\]]/m))));console.log(JSON.stringify(a.map(p=>({name:p.name,id:p.pm_id,pid:p.pid,cpu:p.monit&&p.monit.cpu,memory:p.monit&&p.monit.memory,status:p.pm2_env&&p.pm2_env.status,restarts:p.pm2_env&&p.pm2_env.restart_time,uptime:p.pm2_env&&p.pm2_env.pm_uptime,script:p.pm2_env&&p.pm2_env.pm_exec_path,instances:p.pm2_env&&p.pm2_env.instances}))))})'`

const USER_SNIPPET = `${LOAD_NODE}
command -v pm2 >/dev/null 2>&1 || exit 0
echo "@@user $(id -un)"
systemctl is-enabled "pm2-$(id -un)" >/dev/null 2>&1 && echo @@startup
pidfile="$HOME/.pm2/pm2.pid"
if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
  echo @@jlist
  pm2 jlist 2>/dev/null | ${PROJECT_JLIST}
else
  echo @@stopped
fi
`

export const PM2_SCRIPT = `${LOAD_NODE}
command -v pm2 >/dev/null 2>&1 || { echo @@missing; exit 0; }
echo "@@now $(date +%s)"
sh -c ${shellQuote(USER_SNIPPET)}
`

export const PM2_USERS_SCRIPT = `echo "@@now $(date +%s)"
getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 { print $1 ":" $6 }' | while IFS=: read -r name home; do
  [ "$name" = "\${SUDO_USER:-}" ] && continue
  [ -f "$home/.pm2/pm2.pid" ] || continue
  printf '%s\\n' "$name"
done | head -n 5 | while read -r name; do
  timeout 15 sudo -n -u "$name" -H sh -c ${shellQuote(USER_SNIPPET)} </dev/null
done
`

interface RawApp {
  name?: unknown
  id?: unknown
  cpu?: unknown
  memory?: unknown
  status?: unknown
  restarts?: unknown
  uptime?: unknown
  script?: unknown
  instances?: unknown
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

function toApp(raw: RawApp, nowSeconds: number | null): Pm2App {
  const status = str(raw.status)
  const startedMs = num(raw.uptime)
  const online = status === 'online'
  return {
    name: str(raw.name),
    id: num(raw.id) ?? -1,
    status,
    restarts: num(raw.restarts) ?? 0,
    cpuPercent: online ? num(raw.cpu) : null,
    memoryBytes: online ? num(raw.memory) : null,
    sinceSeconds: nowSeconds !== null && startedMs !== null ? Math.max(0, Math.round(nowSeconds - startedMs / 1000)) : null,
    script: str(raw.script),
    instances: num(raw.instances) ?? 1
  }
}

function parseApps(lines: string[], nowSeconds: number | null): Pm2App[] {
  const json = lines.join('\n').trim()
  if (!json.startsWith('[')) return []
  try {
    const raw = JSON.parse(json) as unknown
    return Array.isArray(raw) ? raw.map((item) => toApp(item as RawApp, nowSeconds)).filter((app) => app.name !== '') : []
  } catch {
    return []
  }
}

function collectUsers(sections: OutputSection[], nowSeconds: number | null): Pm2User[] {
  const users: Pm2User[] = []
  for (const section of sections) {
    const current = users[users.length - 1]
    if (section.marker === 'user') users.push({ user: section.arg, running: false, startup: false, apps: [] })
    else if (current && section.marker === 'startup') current.startup = true
    else if (current && section.marker === 'jlist') Object.assign(current, { running: true, apps: parseApps(section.lines, nowSeconds) })
  }
  return users
}

export function parsePm2(stdout: string): Pm2Data {
  const sections = splitSections(stdout)
  if (sections.some((section) => section.marker === 'missing')) return { installed: false }
  const now = sections.find((section) => section.marker === 'now')?.arg
  const nowSeconds = now && /^\d+$/.test(now) ? Number(now) : null
  return { installed: true, users: collectUsers(sections, nowSeconds) }
}

export const isPm2Problem = (status: string): boolean => status === 'errored'
