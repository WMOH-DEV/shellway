/** Transfer status */
export type TransferStatus = 'queued' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled'

/** Transfer direction */
export type TransferDirection = 'upload' | 'download'

/** A single file transfer */
export interface TransferItem {
  id: string
  fileName: string
  sourcePath: string
  destinationPath: string
  direction: TransferDirection
  status: TransferStatus
  totalBytes: number
  transferredBytes: number
  speed: number        // bytes/sec
  eta: number          // seconds remaining
  error?: string
  startedAt?: number
  completedAt?: number
}

/** Transfer conflict resolution strategy */
export type ConflictResolution =
  | 'overwrite'
  | 'overwrite-if-newer'
  | 'overwrite-if-different-size'
  | 'rename'
  | 'skip'
  | 'resume'
