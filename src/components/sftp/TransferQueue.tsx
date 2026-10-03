import { useMemo, useState } from 'react'
import {
  ChevronRight,
  Folder,
  Pause,
  Play,
  X,
  RotateCw,
  Trash2,
  Upload,
  Download,
  Check,
  AlertCircle
} from 'lucide-react'
import { useTransferStore } from '@/stores/transferStore'
import { cn } from '@/utils/cn'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import { formatFileSize, formatSpeed } from '@/utils/fileSize'
import { summarizeTransfers, summaryPercent } from '@/utils/transferSummary'
import type { TrackedTransfer } from '@/types/transfer'

type QueueEntry =
  | { kind: 'file'; transfer: TrackedTransfer }
  | { kind: 'group'; groupId: string; name: string; transfers: TrackedTransfer[] }

function groupTransfers(transfers: TrackedTransfer[]): QueueEntry[] {
  const entries: QueueEntry[] = []
  const groups = new Map<string, Extract<QueueEntry, { kind: 'group' }>>()
  for (const transfer of transfers) {
    if (!transfer.groupId) {
      entries.push({ kind: 'file', transfer })
      continue
    }
    let group = groups.get(transfer.groupId)
    if (!group) {
      group = { kind: 'group', groupId: transfer.groupId, name: transfer.groupName ?? transfer.groupId, transfers: [] }
      groups.set(transfer.groupId, group)
      entries.push(group)
    }
    group.transfers.push(transfer)
  }
  return entries
}

/**
 * Transfer queue panel — shows active, queued, completed, and failed transfers.
 */
export function TransferQueue() {
  const transfers = useTransferStore((s) => s.transfers)
  const scans = useTransferStore((s) => s.scans)
  const clearCompleted = useTransferStore((s) => s.clearCompleted)
  const entries = useMemo(() => groupTransfers(transfers), [transfers])

  return (
    <div className="h-full flex flex-col">
      {/* Inline toolbar */}
      {transfers.some((t) => t.status === 'completed' || t.status === 'cancelled') && (
        <div className="flex items-center justify-end px-3 py-1 shrink-0">
          <Tooltip content="Clear completed">
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => clearCompleted()}
            >
              <Trash2 size={11} />
            </Button>
          </Tooltip>
        </div>
      )}

      {/* Transfer list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {scans.map((scan) => (
          <div key={scan.groupId} className="flex items-center gap-2 px-3 py-1.5 text-xs text-nd-text-secondary">
            <Spinner size={10} />
            <Folder size={12} className="text-nd-text-muted shrink-0" />
            <span className="truncate">Scanning {scan.groupName}…</span>
          </div>
        ))}
        {entries.length === 0 && scans.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-nd-text-muted">
            No transfers
          </div>
        ) : (
          entries.map((entry) =>
            entry.kind === 'group' ? (
              <TransferGroupRow key={entry.groupId} name={entry.name} transfers={entry.transfers} />
            ) : (
              <TransferRow key={entry.transfer.id} transfer={entry.transfer} />
            )
          )
        )}
      </div>
    </div>
  )
}

function TransferGroupRow({ name, transfers }: { name: string; transfers: TrackedTransfer[] }) {
  const [expanded, setExpanded] = useState(false)
  const summary = useMemo(() => summarizeTransfers(transfers), [transfers])
  const percent = summaryPercent(summary)
  const DirectionIcon = summary.direction === 'upload' ? Upload : Download

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-nd-surface/50 transition-colors text-left"
      >
        <ChevronRight
          size={12}
          className={cn('text-nd-text-muted shrink-0 transition-transform', expanded && 'rotate-90')}
        />
        <DirectionIcon size={12} className={summary.direction === 'upload' ? 'text-nd-accent shrink-0' : 'text-nd-success shrink-0'} />
        <Folder size={12} className="text-nd-text-muted shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-nd-text-primary truncate">{name}</span>
            <span className="text-2xs text-nd-text-muted shrink-0 tabular-nums">
              {summary.doneFiles} / {summary.totalFiles} files · {formatFileSize(summary.transferredBytes)} / {formatFileSize(summary.totalBytes)}
            </span>
            {summary.failedFiles > 0 && (
              <span className="text-2xs text-nd-error shrink-0">{summary.failedFiles} failed</span>
            )}
          </div>
          {summary.isRunning && <ProgressBar value={percent} size="sm" className="mt-1" />}
        </div>
        {summary.isRunning ? (
          <span className="text-2xs text-nd-text-muted shrink-0 tabular-nums w-16 text-right">
            {formatSpeed(summary.speed)}
          </span>
        ) : summary.failedFiles > 0 ? (
          <AlertCircle size={10} className="text-nd-error shrink-0" />
        ) : (
          <Check size={10} className="text-nd-success shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="pl-5">
          {transfers.map((transfer) => (
            <TransferRow key={transfer.id} transfer={transfer} />
          ))}
        </div>
      )}
    </div>
  )
}

function TransferRow({ transfer }: { transfer: TrackedTransfer }) {
  const { connectionId } = transfer
  const progress = transfer.totalBytes > 0
    ? (transfer.transferredBytes / transfer.totalBytes) * 100
    : 0

  const statusIcon = {
    queued: <span className="w-2 h-2 rounded-full bg-nd-text-muted" />,
    active: <Spinner size={10} />,
    paused: <Pause size={10} className="text-nd-warning" />,
    completed: <Check size={10} className="text-nd-success" />,
    failed: <AlertCircle size={10} className="text-nd-error" />,
    cancelled: <X size={10} className="text-nd-text-muted" />
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-nd-surface/50 transition-colors">
      {/* Direction icon */}
      {transfer.direction === 'upload' ? (
        <Upload size={12} className="text-nd-accent shrink-0" />
      ) : (
        <Download size={12} className="text-nd-success shrink-0" />
      )}

      {/* File info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-nd-text-primary truncate">{transfer.fileName}</span>
          <span className="text-2xs text-nd-text-muted shrink-0">
            {formatFileSize(transfer.transferredBytes)} / {formatFileSize(transfer.totalBytes)}
          </span>
        </div>
        {transfer.status === 'active' && (
          <ProgressBar value={progress} size="sm" className="mt-1" />
        )}
      </div>

      {/* Speed / ETA */}
      {transfer.status === 'active' && (
        <span className="text-2xs text-nd-text-muted shrink-0 tabular-nums w-16 text-right">
          {formatSpeed(transfer.speed)}
        </span>
      )}

      {/* Status / actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        {transfer.status === 'active' && (
          <button
            onClick={() => window.novadeck.sftp.transferPause(connectionId, transfer.id)}
            className="p-0.5 rounded text-nd-text-muted hover:text-nd-text-primary transition-colors"
          >
            <Pause size={11} />
          </button>
        )}
        {transfer.status === 'paused' && (
          <button
            onClick={() => window.novadeck.sftp.transferResume(connectionId, transfer.id)}
            className="p-0.5 rounded text-nd-text-muted hover:text-nd-text-primary transition-colors"
          >
            <Play size={11} />
          </button>
        )}
        {transfer.status === 'failed' && (
          <button
            onClick={() => window.novadeck.sftp.transferRetry(connectionId, transfer.id)}
            className="p-0.5 rounded text-nd-error hover:text-red-300 transition-colors"
          >
            <RotateCw size={11} />
          </button>
        )}
        {(transfer.status === 'active' || transfer.status === 'queued' || transfer.status === 'paused') && (
          <button
            onClick={() => window.novadeck.sftp.transferCancel(connectionId, transfer.id)}
            className="p-0.5 rounded text-nd-text-muted hover:text-nd-error transition-colors"
          >
            <X size={11} />
          </button>
        )}
      </div>
    </div>
  )
}

function Spinner({ size }: { size: number }) {
  return (
    <div
      className="animate-spin rounded-full border-nd-accent border-t-transparent"
      style={{ width: size, height: size, borderWidth: 1.5 }}
    />
  )
}
