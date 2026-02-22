import { EventEmitter } from 'events'
import { SFTPService } from './SFTPService'

export type TransferStatus = 'queued' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled'
export type TransferDirection = 'upload' | 'download'

export interface TransferItem {
  id: string
  fileName: string
  sourcePath: string
  destinationPath: string
  direction: TransferDirection
  status: TransferStatus
  totalBytes: number
  transferredBytes: number
  speed: number
  eta: number
  error?: string
  startedAt?: number
  completedAt?: number
}

/**
 * TransferQueue — manages file upload/download operations.
 * Supports concurrent transfers, pause/resume, cancellation.
 * Emits: 'update', 'complete', 'error'
 */
export class TransferQueue extends EventEmitter {
  private items: Map<string, TransferItem> = new Map()
  private activeCount = 0
  private maxConcurrent = 3
  private sftpService: SFTPService | null = null

  /** Bandwidth limits in KB/s (0 = unlimited) */
  bandwidthLimitUp: number = 0
  bandwidthLimitDown: number = 0

  /** Whether to preserve file timestamps on transfer */
  preserveTimestamps: boolean = true

  constructor(maxConcurrent: number = 3) {
    super()
    this.maxConcurrent = maxConcurrent
  }

  /** Set the SFTP service for transfers */
  setSFTPService(sftp: SFTPService): void {
    this.sftpService = sftp

    // Listen for progress events
    sftp.on('progress', (transferId: string, transferred: number, total: number) => {
      const item = this.items.get(transferId)
      if (item && item.status === 'active') {
        const now = Date.now()
        const elapsed = (now - (item.startedAt || now)) / 1000
        const speed = elapsed > 0 ? transferred / elapsed : 0
        const remaining = total - transferred
        const eta = speed > 0 ? remaining / speed : 0

        item.transferredBytes = transferred
        item.totalBytes = total
        item.speed = speed
        item.eta = eta

        this.emit('update', this.getTransferState(transferId))
      }
    })
  }

  /** Add a transfer to the queue */
  enqueue(item: Omit<TransferItem, 'status' | 'transferredBytes' | 'speed' | 'eta'>): TransferItem {
    const transfer: TransferItem = {
      ...item,
      status: 'queued',
      transferredBytes: 0,
      speed: 0,
      eta: 0
    }

    this.items.set(transfer.id, transfer)
    this.emit('update', this.getTransferState(transfer.id))
    this.processQueue()
    return transfer
  }

  /** Pause a transfer */
  pause(id: string): void {
    const item = this.items.get(id)
    if (item && item.status === 'active') {
      item.status = 'paused'
      this.emit('update', this.getTransferState(id))
    }
  }

  /** Resume a paused transfer */
  resume(id: string): void {
    const item = this.items.get(id)
    if (item && item.status === 'paused') {
      item.status = 'queued'
      this.emit('update', this.getTransferState(id))
      this.processQueue()
    }
  }

  /** Cancel a transfer */
  cancel(id: string): void {
    const item = this.items.get(id)
    if (item && (item.status === 'queued' || item.status === 'active' || item.status === 'paused')) {
      const wasActive = item.status === 'active'
      item.status = 'cancelled'
      if (wasActive) this.activeCount--
      this.emit('update', this.getTransferState(id))
      this.processQueue()
    }
  }

  /** Cancel all transfers */
  cancelAll(): void {
    for (const [id, item] of this.items) {
      if (item.status === 'queued' || item.status === 'active' || item.status === 'paused') {
        item.status = 'cancelled'
        this.emit('update', this.getTransferState(id))
      }
    }
    this.activeCount = 0
  }

  /** Retry a failed transfer */
  retry(id: string): void {
    const item = this.items.get(id)
    if (item && item.status === 'failed') {
      item.status = 'queued'
      item.transferredBytes = 0
      item.speed = 0
      item.eta = 0
      item.error = undefined
      this.emit('update', this.getTransferState(id))
      this.processQueue()
    }
  }

  /** Remove a completed/failed/cancelled transfer from the list */
  remove(id: string): void {
    this.items.delete(id)
  }

  /** Get all transfer items */
  getAll(): TransferItem[] {
    return Array.from(this.items.values())
  }

  /** Get a single transfer state */
  getTransferState(id: string): TransferItem | undefined {
    return this.items.get(id)
  }

  /** Process the queue — start transfers up to maxConcurrent */
  private async processQueue(): Promise<void> {
    if (!this.sftpService || this.activeCount >= this.maxConcurrent) return

    const queued = Array.from(this.items.values()).filter((i) => i.status === 'queued')

    for (const item of queued) {
      if (this.activeCount >= this.maxConcurrent) break

      item.status = 'active'
      item.startedAt = Date.now()
      this.activeCount++
      this.emit('update', this.getTransferState(item.id))

      this.executeTransfer(item).catch(() => {
        // Errors handled in executeTransfer
      })
    }
  }

  private async executeTransfer(item: TransferItem): Promise<void> {
    try {
      if (item.direction === 'download') {
        await this.sftpService!.download(
          item.sourcePath, item.destinationPath, item.id,
          this.bandwidthLimitDown, this.preserveTimestamps
        )
      } else {
        await this.sftpService!.upload(
          item.sourcePath, item.destinationPath, item.id,
          this.bandwidthLimitUp, this.preserveTimestamps
        )
      }

      if (item.status === 'active') {
        item.status = 'completed'
        item.completedAt = Date.now()
        item.transferredBytes = item.totalBytes
        this.emit('update', this.getTransferState(item.id))
        this.emit('complete', item)
      }
    } catch (err: unknown) {
      if (item.status === 'active') {
        item.status = 'failed'
        item.error = err instanceof Error ? err.message : 'Transfer failed'
        this.emit('update', this.getTransferState(item.id))
        this.emit('error', item)
      }
    } finally {
      this.activeCount--
      this.processQueue()
    }
  }
}
