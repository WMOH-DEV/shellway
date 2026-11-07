import { hasMarker, sectionLines, splitSections } from './sections'
import type { Container, ContainersData, DockerAccess } from './types'

export const CONTAINERS_SCRIPT = `command -v docker >/dev/null 2>&1 || { echo @@missing; exit 0; }
if docker ps -q >/dev/null 2>&1; then D=docker; echo "@@access direct"
elif sudo -n docker ps -q >/dev/null 2>&1; then D="sudo -n docker"; echo "@@access sudo"
else echo @@denied; exit 0; fi
echo @@ps
$D ps -a --no-trunc --format '{{json .}}' 2>/dev/null
ids=$($D ps -aq 2>/dev/null)
[ -n "$ids" ] || exit 0
echo @@restart
$D inspect --format '{{.Name}} {{.HostConfig.RestartPolicy.Name}}' $ids 2>/dev/null
echo @@stats
timeout 10 $D stats --no-stream --no-trunc --format '{{json .}}' 2>/dev/null
`

const SIZE_UNITS: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 }

export function parseSize(text: string): number | null {
  const match = /^([\d.]+)\s*([a-z]+)$/i.exec(text.trim())
  const factor = match ? SIZE_UNITS[match[2].toLowerCase()] : undefined
  return match && factor ? Math.round(Number(match[1]) * factor) : null
}

function jsonLines(lines: string[]): Record<string, unknown>[] {
  return lines.flatMap((line) => {
    try {
      const value = JSON.parse(line) as unknown
      return value && typeof value === 'object' ? [value as Record<string, unknown>] : []
    } catch {
      return []
    }
  })
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

function composeProject(labels: string): string {
  return /(?:^|,)com\.docker\.compose\.project=([^,]*)/.exec(labels)?.[1] ?? ''
}

function stateOf(row: Record<string, unknown>): string {
  const state = text(row.State).toLowerCase()
  if (state) return state
  return text(row.Status).startsWith('Up') ? 'running' : 'exited'
}

interface Usage {
  cpuPercent: number | null
  memoryBytes: number | null
}

function parseStats(lines: string[]): Map<string, Usage> {
  return new Map(
    jsonLines(lines).map((row) => {
      const cpu = Number.parseFloat(text(row.CPUPerc))
      return [text(row.Name), { cpuPercent: Number.isFinite(cpu) ? cpu : null, memoryBytes: parseSize(text(row.MemUsage).split('/')[0] ?? '') }]
    })
  )
}

function parseRestartPolicies(lines: string[]): Map<string, string> {
  return new Map(lines.map((line) => line.trim().replace(/^\//, '').split(/\s+/) as [string, string]).map(([name, policy]) => [name, policy ?? '']))
}

function toContainer(row: Record<string, unknown>, policies: Map<string, string>, usage: Map<string, Usage>): Container {
  const name = text(row.Names).split(',')[0]
  return {
    id: text(row.ID).slice(0, 12),
    name,
    image: text(row.Image),
    state: stateOf(row),
    status: text(row.Status),
    project: composeProject(text(row.Labels)),
    restartPolicy: policies.get(name) ?? '',
    cpuPercent: usage.get(name)?.cpuPercent ?? null,
    memoryBytes: usage.get(name)?.memoryBytes ?? null
  }
}

export function parseContainers(stdout: string): ContainersData {
  const sections = splitSections(stdout)
  if (hasMarker(sections, 'missing')) return { installed: false }
  if (hasMarker(sections, 'denied')) return { installed: true, access: null, containers: [] }
  const access: DockerAccess = sections.find((section) => section.marker === 'access')?.arg === 'sudo' ? 'sudo' : 'direct'
  const policies = parseRestartPolicies(sectionLines(sections, 'restart'))
  const usage = parseStats(sectionLines(sections, 'stats'))
  const containers = jsonLines(sectionLines(sections, 'ps')).map((row) => toContainer(row, policies, usage)).filter((container) => container.name !== '')
  return { installed: true, access, containers }
}
