import { hasMarker, sectionLines, splitSections } from './sections'
import type { SupervisorData, SupervisorProgram } from './types'

export const SUPERVISOR_SCRIPT = `command -v supervisorctl >/dev/null 2>&1 || { echo @@missing; exit 0; }
status=$(supervisorctl status 2>&1)
echo @@status
printf '%s\\n' "$status"
pids=$(printf '%s\\n' "$status" | sed -n 's/.* pid \\([0-9][0-9]*\\),.*/\\1/p' | tr '\\n' ',' | sed 's/,$//')
[ -n "$pids" ] || exit 0
echo @@ps
ps -o pid=,pcpu=,rss= -p "$pids" 2>/dev/null
`

const STATUS_LINE = /^(\S+)\s+(RUNNING|STARTING|STOPPED|STOPPING|BACKOFF|FATAL|EXITED|UNKNOWN)\b\s*(.*)$/
const DAEMON_DOWN = /refused connection|no such file|SHUTDOWN_STATE|connection refused/i

interface ProcessUsage {
  cpuPercent: number
  memoryBytes: number
}

function parseProgram(line: string): SupervisorProgram | null {
  const match = STATUS_LINE.exec(line.trim())
  if (!match) return null
  const [, name, state, rest] = match
  const running = /^pid (\d+), uptime (.+)$/.exec(rest)
  return {
    name,
    state,
    pid: running ? Number(running[1]) : null,
    uptime: running ? running[2].trim() : '',
    description: running ? '' : rest.trim(),
    cpuPercent: null,
    memoryBytes: null
  }
}

function parseUsage(lines: string[]): Map<number, ProcessUsage> {
  const usage = new Map<number, ProcessUsage>()
  for (const line of lines) {
    const [pid, cpu, rss] = line.trim().split(/\s+/).map(Number)
    if (Number.isFinite(pid) && Number.isFinite(cpu) && Number.isFinite(rss)) usage.set(pid, { cpuPercent: cpu, memoryBytes: rss * 1024 })
  }
  return usage
}

export function parseSupervisor(stdout: string): SupervisorData {
  const sections = splitSections(stdout)
  if (hasMarker(sections, 'missing')) return { installed: false }
  const statusLines = sectionLines(sections, 'status')
  const usage = parseUsage(sectionLines(sections, 'ps'))
  const programs = statusLines
    .map(parseProgram)
    .filter((program): program is SupervisorProgram => program !== null)
    .map((program) => ({ ...program, ...(program.pid !== null ? usage.get(program.pid) : undefined) }))
  const running = programs.length > 0 || !statusLines.some((line) => DAEMON_DOWN.test(line))
  return { installed: true, running, programs }
}

export const isSupervisorProblem = (state: string): boolean => state === 'FATAL' || state === 'BACKOFF' || state === 'STOPPED'
