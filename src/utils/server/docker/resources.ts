import { DOWN_MARKER, lines, listProbeScript, parseJsonLines, splitSections, str } from './shell'
import { parseSize } from './size'
import type { ContainerStats, DiskUsageKind, DockerDiskUsage, DockerNetwork, DockerVolume } from './types'

const LIST_LIMIT = 500

const jsonList = (command: string): string =>
  [`out=$($D ${command} --format '{{json .}}' 2>/dev/null) || { echo ${DOWN_MARKER}; exit 0; }`, `printf '%s\\n' "$out" | head -n ${LIST_LIMIT}`].join('\n')

export const VOLUMES_SCRIPT = listProbeScript([
  jsonList('volume ls'),
  'echo "@@section dangling"',
  '$D volume ls -q --filter dangling=true 2>/dev/null'
].join('\n'))

export const NETWORKS_SCRIPT = listProbeScript(jsonList('network ls'))

export const DF_SCRIPT = listProbeScript(jsonList('system df'))

export const STATS_SCRIPT = listProbeScript(jsonList('stats --no-stream'))

export function parseVolumes(stdout: string): DockerVolume[] {
  const sections = splitSections(stdout)
  const dangling = new Set(lines(sections.dangling ?? ''))
  return parseJsonLines(sections.main).map((raw) => ({
    name: str(raw.Name),
    driver: str(raw.Driver),
    mountpoint: str(raw.Mountpoint),
    dangling: dangling.has(str(raw.Name))
  }))
}

export function parseNetworks(stdout: string): DockerNetwork[] {
  return parseJsonLines(stdout).map((raw) => ({
    id: str(raw.ID),
    name: str(raw.Name),
    driver: str(raw.Driver),
    scope: str(raw.Scope),
    internal: str(raw.Internal) === 'true'
  }))
}

const DF_KINDS: Record<string, DiskUsageKind> = {
  Images: 'images',
  Containers: 'containers',
  'Local Volumes': 'volumes',
  'Build Cache': 'buildCache'
}

export function parseDiskUsage(stdout: string): DockerDiskUsage {
  return Object.fromEntries(parseJsonLines(stdout).flatMap((raw) => {
    const kind = DF_KINDS[str(raw.Type)]
    if (!kind) return []
    const row = {
      total: Number(str(raw.TotalCount)) || 0,
      active: Number(str(raw.Active)) || 0,
      size: parseSize(str(raw.Size)),
      reclaimable: parseSize(str(raw.Reclaimable))
    }
    return [[kind, row]]
  }))
}

export function parseStats(stdout: string): ContainerStats[] {
  return parseJsonLines(stdout).map((raw) => ({
    name: str(raw.Name),
    cpu: str(raw.CPUPerc),
    memory: str(raw.MemUsage).split('/')[0]?.trim() ?? ''
  }))
}
