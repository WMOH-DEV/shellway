import { blocksTagged, blockText, hasTag, splitBlocks, type Block } from './shell'
import type { AppEnv, ConfFile, ServiceState, SupervisorFacts, SupervisorProcess, SupervisorProgram, SupervisorState } from './types'

export const SUPERVISOR_CONF_DIR = '/etc/supervisor/conf.d'
export const DEPENDENCY_SERVICES = ['redis-server', 'redis', 'mysql', 'mariadb', 'postgresql'] as const

export const shellwayConfPath = (name: string): string => `${SUPERVISOR_CONF_DIR}/shellway-${name}.conf`

const STATES: readonly SupervisorState[] = ['STOPPED', 'STARTING', 'RUNNING', 'BACKOFF', 'STOPPING', 'EXITED', 'FATAL', 'UNKNOWN']
const STATUS_LINE = /^(\S+)\s+([A-Z]+)\s*(.*)$/
const UNREACHABLE = /unix:\/\/|refused|no such file|SHUTDOWN_STATE/i
const SHELLWAY_FILE = /\/shellway-[^/]+\.conf$/

export function parseStatus(lines: string[]): SupervisorProcess[] {
  return lines.flatMap((line) => {
    const match = STATUS_LINE.exec(line.trim())
    if (!match || !STATES.includes(match[2] as SupervisorState)) return []
    return [{ name: match[1], state: match[2] as SupervisorState, description: match[3].trim() }]
  })
}

type Section = { name: string; values: Record<string, string> }

function parseSections(content: string): Section[] {
  const sections: Section[] = []
  let key = ''
  for (const raw of content.split('\n')) {
    const header = /^\s*\[program:([^\]]+)\]\s*$/.exec(raw)
    if (header) {
      sections.push({ name: header[1].trim(), values: {} })
      key = ''
      continue
    }
    if (/^\s*\[/.test(raw)) {
      key = ''
      sections.push({ name: '', values: {} })
      continue
    }
    const current = sections.at(-1)
    if (!current || /^\s*[;#]/.test(raw) || raw.trim() === '') continue
    const line = raw.replace(/\s;.*$/, '')
    if (/^\s/.test(line) && key) {
      current.values[key] = `${current.values[key]} ${line.trim()}`
      continue
    }
    const pair = /^([A-Za-z_]+)\s*=\s*(.*)$/.exec(line)
    if (!pair) continue
    key = pair[1].toLowerCase()
    current.values[key] = pair[2].trim()
  }
  return sections.filter((section) => section.name !== '')
}

const truthy = (value: string | undefined, fallback: boolean): boolean => (value === undefined ? fallback : /^(true|yes|on|1)$/i.test(value))

function programOf(section: Section, file: string): SupervisorProgram {
  const { values } = section
  const numprocs = Number.parseInt(values.numprocs ?? '1', 10)
  return {
    name: section.name,
    file,
    command: values.command ?? '',
    directory: values.directory ?? '',
    user: values.user ?? '',
    numprocs: Number.isFinite(numprocs) && numprocs > 0 ? numprocs : 1,
    autostart: truthy(values.autostart, true),
    stdoutLogfile: values.stdout_logfile ?? 'AUTO',
    shellway: SHELLWAY_FILE.test(file),
    processes: []
  }
}

export const processGroup = (processName: string): string => processName.split(':')[0]

function attachProcesses(programs: SupervisorProgram[], processes: SupervisorProcess[]): SupervisorProgram[] {
  const byName = new Map(programs.map((program) => [program.name, { ...program, processes: [] as SupervisorProcess[] }]))
  for (const process of processes) {
    const group = processGroup(process.name)
    const program = byName.get(group) ?? { ...programOf({ name: group, values: {} }, ''), file: null }
    program.processes.push(process)
    byName.set(group, program)
  }
  return [...byName.values()]
}

function confFiles(blocks: Block[]): ConfFile[] {
  return blocksTagged(blocks, 'file').map((block) => {
    const [sha256, ...path] = block.args.split(' ').reverse()
    return { path: path.reverse().join(' '), sha256, content: blockText(block) }
  })
}

function services(blocks: Block[]): Record<string, ServiceState> {
  return Object.fromEntries(
    blocksTagged(blocks, 'service').map((block) => {
      const [name, load = '', active = ''] = block.args.split(' ')
      return [name, { load, active }]
    })
  )
}

function appEnv(blocks: Block[]): Record<string, AppEnv> {
  return Object.fromEntries(
    blocksTagged(blocks, 'env').map((block) => {
      const [queue, db, ...dir] = block.args.split(' ')
      return [dir.join(' '), { queue: queue === '-' ? '' : queue, db: db === '-' ? '' : db }]
    })
  )
}

export function parseSupervisor(stdout: string): SupervisorFacts {
  const blocks = splitBlocks(stdout)
  if (hasTag(blocks, 'missing')) return { installed: false, running: false, programs: [], files: [], services: services(blocks), appEnv: {} }
  const statusLines = blocksTagged(blocks, 'status').flatMap((block) => block.lines)
  const files = confFiles(blocks)
  const programs = files.flatMap((file) => parseSections(file.content).map((section) => programOf(section, file.path)))
  return {
    installed: true,
    running: !statusLines.some((line) => UNREACHABLE.test(line)),
    programs: attachProcesses(programs, parseStatus(statusLines)),
    files,
    services: services(blocks),
    appEnv: appEnv(blocks)
  }
}

const SERVICE_LOOP = DEPENDENCY_SERVICES.join(' ')

export const SUPERVISOR_SCRIPT = `for s in ${SERVICE_LOOP}; do
  echo "@@service $s $(systemctl show -p LoadState --value "$s" 2>/dev/null) $(systemctl show -p ActiveState --value "$s" 2>/dev/null)"
done
if ! command -v supervisorctl >/dev/null 2>&1; then echo '@@missing'; exit 0; fi
echo '@@status'
supervisorctl status 2>&1 | head -n 500
for f in $(ls -1 ${SUPERVISOR_CONF_DIR}/*.conf 2>/dev/null | head -n 100); do
  [ -f "$f" ] || continue
  echo "@@file $f $(sha256sum < "$f" | cut -c1-64)"
  head -c 65536 "$f"
  echo
  echo '@@end'
done
cat ${SUPERVISOR_CONF_DIR}/*.conf 2>/dev/null | sed -n 's/^directory[[:space:]]*=[[:space:]]*//p' | sort -u | head -n 30 | while IFS= read -r d; do
  [ -f "$d/.env" ] || continue
  q=$(sed -n 's/^QUEUE_CONNECTION=//p' "$d/.env" | head -n 1 | tr -d '"'"'"' \\r')
  b=$(sed -n 's/^DB_CONNECTION=//p' "$d/.env" | head -n 1 | tr -d '"'"'"' \\r')
  echo "@@env \${q:--} \${b:--} $d"
done
`
