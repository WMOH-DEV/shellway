import type { TransferDirection, TransferItem } from '@/types/transfer'

export interface TransferSummary {
  direction: TransferDirection | 'mixed'
  totalFiles: number
  doneFiles: number
  failedFiles: number
  cancelledFiles: number
  totalBytes: number
  transferredBytes: number
  speed: number
  isRunning: boolean
}

export function isPending(t: TransferItem): boolean {
  return t.status === 'queued' || t.status === 'active' || t.status === 'paused'
}

export function summarizeTransfers(items: TransferItem[]): TransferSummary {
  const directions = new Set(items.map((t) => t.direction))
  return {
    direction: directions.size === 1 ? items[0].direction : 'mixed',
    totalFiles: items.length,
    doneFiles: items.filter((t) => t.status === 'completed').length,
    failedFiles: items.filter((t) => t.status === 'failed').length,
    cancelledFiles: items.filter((t) => t.status === 'cancelled').length,
    totalBytes: items.reduce((sum, t) => sum + t.totalBytes, 0),
    transferredBytes: items.reduce((sum, t) => sum + t.transferredBytes, 0),
    speed: items.reduce((sum, t) => sum + (t.status === 'active' ? t.speed : 0), 0),
    isRunning: items.some(isPending)
  }
}

export function summaryPercent(summary: TransferSummary): number {
  if (summary.totalBytes > 0) {
    return Math.min(100, Math.round((summary.transferredBytes / summary.totalBytes) * 100))
  }
  if (summary.totalFiles === 0) return 0
  const settled = summary.doneFiles + summary.failedFiles + summary.cancelledFiles
  return Math.round((settled / summary.totalFiles) * 100)
}
