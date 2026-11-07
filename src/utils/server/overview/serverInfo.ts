import type { MonitorSnapshot } from '@/types/monitor'
import type { ServerIdentity } from '@/types/server/identity'
import { formatDateTime } from '@/utils/ssl/time'
import type { Filesystem } from './disk'
import { formatSize, formatUptime } from './format'
import type { SystemState } from './system'

export interface InfoRow {
  label: string
  value: string
  mono: boolean
}

export interface SessionTarget {
  host: string
  port: number
  username: string
}

export interface ConnectionHealth {
  status: string
  latencyMs: number | null
}

export interface InfoInput {
  identity: ServerIdentity | null
  snapshot: MonitorSnapshot | null
  system: SystemState | null
  rootFs: Filesystem | null
  session: SessionTarget | null
  connection: ConnectionHealth
}

type Value = string | null | undefined

const row = (label: string, value: Value, mono = false): InfoRow | null => (value ? { label, value, mono } : null)

const joined = (...parts: Value[]): string | null => parts.filter(Boolean).join(' · ') || null

function cpuText(identity: ServerIdentity | null, snapshot: MonitorSnapshot | null): string | null {
  const cpus = identity?.cpus || snapshot?.cpuCount
  return joined(cpus ? `${cpus} vCPU` : null, snapshot?.cpuModel)
}

function memoryText(identity: ServerIdentity | null, snapshot: MonitorSnapshot | null): string | null {
  const total = identity?.memoryBytes || snapshot?.memTotalBytes
  const swap = snapshot?.swapTotalBytes
  return joined(total ? formatSize(total) : null, swap ? `swap ${formatSize(swap)}` : null)
}

function sshText(identity: ServerIdentity | null, session: SessionTarget | null): string | null {
  const user = identity?.user || session?.username
  const port = identity?.sshPort || session?.port
  return joined(user, port ? `port ${port}` : null)
}

function uptimeText(identity: ServerIdentity | null, snapshot: MonitorSnapshot | null): string | null {
  const seconds = snapshot?.uptime ?? identity?.uptimeSeconds
  return seconds ? formatUptime(seconds) : null
}

function connectionText({ status, latencyMs }: ConnectionHealth): string {
  return joined(status, latencyMs !== null && latencyMs >= 0 ? `${latencyMs} ms` : null) ?? status
}

export function serverInfoRows({ identity, snapshot, system, rootFs, session, connection }: InfoInput): InfoRow[] {
  return [
    row('Hostname', identity?.hostname || snapshot?.hostname, true),
    row('Address', session?.host, true),
    row('Server IP', identity?.primaryIp, true),
    row('SSH user', sshText(identity, session)),
    row('OS', identity?.os.prettyName || snapshot?.os),
    row('Kernel', identity?.kernel || snapshot?.kernel, true),
    row('Architecture', identity?.arch, true),
    row('Virtualization', identity?.virtualization),
    row('CPU', cpuText(identity, snapshot)),
    row('Memory', memoryText(identity, snapshot)),
    row('Disk', rootFs ? `${formatSize(rootFs.sizeBytes)} on /` : null),
    row('Timezone', identity?.timezone),
    row('Uptime', uptimeText(identity, snapshot)),
    row('Last reboot', system?.bootedAt ? formatDateTime(system.bootedAt) : null),
    row('Connection', connectionText(connection))
  ].filter((item): item is InfoRow => item !== null)
}

export const infoCopyText = (rows: InfoRow[]): string => rows.map((item) => `${item.label}: ${item.value}`).join('\n')
