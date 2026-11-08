import type { MonitorSnapshot } from '@/types/monitor'
import { usageLevel } from '@/utils/usageLevel'
import type { Filesystem } from '@/utils/server/overview/disk'
import { rootFilesystem } from '@/utils/server/overview/disk'
import { formatDownUp, formatRate, formatUsage, percentOf } from '@/utils/server/overview/format'
import type { LoadSample } from '@/utils/server/overview/load'

export type HealthTone = 'success' | 'warning' | 'error' | 'info' | 'neutral'

export interface DiskUse {
  usedBytes: number
  sizeBytes: number
  usedPercent: number
  mount: string
}

export interface HealthSample {
  cpuPercent: number
  cpus: number
  load1: number
  memUsedBytes: number
  memTotalBytes: number
  swapUsedPercent: number
  disk: DiskUse | null
  rxPerSec: number
  txPerSec: number
  netPeak: number
}

export interface HealthCell {
  key: 'cpu' | 'memory' | 'disk' | 'network'
  label: string
  value: string
  percent: number
  tone: HealthTone
  meta: string
}

const percentCell = (key: HealthCell['key'], label: string, percent: number, meta: string): HealthCell => ({
  key,
  label,
  value: `${Math.round(percent)}%`,
  percent,
  tone: usageLevel(percent),
  meta
})

function diskCell(disk: DiskUse | null): HealthCell {
  if (!disk) return { key: 'disk', label: 'Disk', value: '—', percent: 0, tone: 'neutral', meta: 'No disk data yet' }
  return percentCell('disk', 'Disk', disk.usedPercent, `${formatUsage(disk.usedBytes, disk.sizeBytes)} on ${disk.mount}`)
}

function networkCell({ rxPerSec, txPerSec, netPeak }: HealthSample): HealthCell {
  const total = rxPerSec + txPerSec
  return { key: 'network', label: 'Network', value: formatRate(total), percent: percentOf(total, netPeak), tone: 'info', meta: formatDownUp(rxPerSec, txPerSec) }
}

export function healthCells(sample: HealthSample): HealthCell[] {
  const memPercent = percentOf(sample.memUsedBytes, sample.memTotalBytes)
  return [
    percentCell('cpu', 'CPU', sample.cpuPercent, `${sample.cpus} vCPU · load ${sample.load1.toFixed(2)}`),
    percentCell('memory', 'Memory', memPercent, `${formatUsage(sample.memUsedBytes, sample.memTotalBytes)} · swap ${Math.round(sample.swapUsedPercent)}%`),
    diskCell(sample.disk),
    networkCell(sample)
  ]
}

const netTotal = (snapshot: MonitorSnapshot): number => snapshot.netInterfaces.reduce((sum, n) => sum + n.rxBytesPerSec + n.txBytesPerSec, 0)

function snapshotDisk(snapshot: MonitorSnapshot): DiskUse | null {
  const disk = snapshot.disks.find((d) => d.mountpoint === '/') ?? snapshot.disks[0]
  return disk ? { usedBytes: disk.usedBytes, sizeBytes: disk.sizeBytes, usedPercent: disk.usedPercent, mount: disk.mountpoint } : null
}

const filesystemDisk = (fs: Filesystem | null): DiskUse | null =>
  fs ? { usedBytes: fs.usedBytes, sizeBytes: fs.sizeBytes, usedPercent: fs.usedPercent, mount: fs.mount } : null

export function sampleFromSnapshot(snapshot: MonitorSnapshot, history: MonitorSnapshot[]): HealthSample {
  return {
    cpuPercent: snapshot.cpuPercent,
    cpus: snapshot.cpuCount,
    load1: snapshot.load[0],
    memUsedBytes: snapshot.memUsedBytes,
    memTotalBytes: snapshot.memTotalBytes,
    swapUsedPercent: snapshot.swapUsedPercent,
    disk: snapshotDisk(snapshot),
    rxPerSec: snapshot.netInterfaces.reduce((sum, n) => sum + n.rxBytesPerSec, 0),
    txPerSec: snapshot.netInterfaces.reduce((sum, n) => sum + n.txBytesPerSec, 0),
    netPeak: Math.max(netTotal(snapshot), ...history.map(netTotal))
  }
}

export function sampleFromProbe(load: LoadSample, filesystems: Filesystem[] | null): HealthSample {
  return {
    cpuPercent: load.cpuPercent,
    cpus: load.cpus,
    load1: load.load[0],
    memUsedBytes: Math.max(0, load.memTotalBytes - load.memAvailableBytes),
    memTotalBytes: load.memTotalBytes,
    swapUsedPercent: percentOf(load.swapTotalBytes - load.swapFreeBytes, load.swapTotalBytes),
    disk: filesystemDisk(filesystems ? rootFilesystem(filesystems) : null),
    rxPerSec: load.rxPerSec,
    txPerSec: load.txPerSec,
    netPeak: 0
  }
}
