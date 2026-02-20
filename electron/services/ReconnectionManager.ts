import { EventEmitter } from 'events'
import type { ReconnectionConfig } from '../../src/types/session'

/** State of the reconnection manager */
export type ReconnectionState = 'idle' | 'waiting' | 'attempting' | 'paused'

/**
 * ReconnectionManager — implements exponential backoff reconnection strategy.
 *
 * Events:
 *   'attempt'   → (connectionId, attemptNumber)
 *   'waiting'   → (connectionId, delayMs, attemptNumber, nextRetryAt)
 *   'success'   → (connectionId, attemptNumber)
 *   'failed'    → (connectionId, attemptNumber, error)
 *   'exhausted' → (connectionId, totalAttempts)
 *   'paused'    → (connectionId)
 *   'resumed'   → (connectionId)
 */
export class ReconnectionManager extends EventEmitter {
  private config: ReconnectionConfig
  private currentAttempt: number = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private _state: ReconnectionState = 'idle'
  private _connectionId: string | null = null
  private _nextRetryAt: number | null = null

  constructor(config: ReconnectionConfig) {
    super()
    this.config = config
  }

  get state(): ReconnectionState {
    return this._state
  }

  get connectionId(): string | null {
    return this._connectionId
  }

  get attempt(): number {
    return this.currentAttempt
  }

  get maxAttempts(): number {
    return this.config.maxAttempts
  }

  get nextRetryAt(): number | null {
    return this._nextRetryAt
  }

  /** Update the config at runtime (e.g. if user changes settings) */
  updateConfig(config: ReconnectionConfig): void {
    this.config = config
  }

  /**
   * Calculate the delay for the current attempt using exponential backoff.
   * Attempt 0 = immediate (0 delay)
   * Attempt 1+ = initialDelay * (multiplier ^ (attempt - 1)), capped at maxDelay
   */
  private getDelay(): number {
    if (this.currentAttempt === 0) return 0 // First retry is immediate

    const baseDelay =
      this.config.initialDelay *
      Math.pow(this.config.backoffMultiplier, this.currentAttempt - 1)
    const capped = Math.min(baseDelay, this.config.maxDelay)

    if (this.config.jitter) {
      // ±20% jitter
      const jitterRange = capped * 0.2
      return capped + (Math.random() * jitterRange * 2 - jitterRange)
    }
    return capped
  }

  /** Start the reconnection cycle */
  start(connectionId: string): void {
    if (!this.config.enabled) return

    this._connectionId = connectionId
    this.currentAttempt = 0
    this.scheduleNext()
  }

  /** Schedule the next reconnection attempt */
  private scheduleNext(): void {
    if (!this._connectionId) return

    // Check if we've exhausted max attempts (0 = unlimited)
    if (this.config.maxAttempts > 0 && this.currentAttempt >= this.config.maxAttempts) {
      this._state = 'idle'
      this.emit('exhausted', this._connectionId, this.currentAttempt)
      return
    }

    const delaySeconds = this.getDelay()
    const delayMs = delaySeconds * 1000

    if (delayMs === 0) {
      // Immediate attempt
      this._state = 'attempting'
      this.currentAttempt++
      this._nextRetryAt = null
      this.emit('attempt', this._connectionId, this.currentAttempt)
    } else {
      // Wait then attempt
      this._state = 'waiting'
      this._nextRetryAt = Date.now() + delayMs
      this.emit('waiting', this._connectionId, delayMs, this.currentAttempt + 1, this._nextRetryAt)

      this.timer = setTimeout(() => {
        this.timer = null
        this._state = 'attempting'
        this.currentAttempt++
        this._nextRetryAt = null
        this.emit('attempt', this._connectionId, this.currentAttempt)
      }, delayMs)
    }
  }

  /** Called when an attempt fails — schedule the next one */
  onFailure(error: string): void {
    if (!this._connectionId) return

    this.emit('failed', this._connectionId, this.currentAttempt, error)
    this.scheduleNext()
  }

  /** Called on successful reconnect — resets counters */
  onSuccess(): void {
    if (!this._connectionId) return

    this.emit('success', this._connectionId, this.currentAttempt)

    if (this.config.resetAfterSuccess) {
      this.currentAttempt = 0
    }

    this.clearTimer()
    this._state = 'idle'
    this._nextRetryAt = null
  }

  /** Cancel reconnection (user manually disconnected) */
  cancel(): void {
    this.clearTimer()
    this._state = 'idle'
    this._nextRetryAt = null
    this.currentAttempt = 0
  }

  /** Pause reconnection (user clicked "pause retrying") */
  pause(): void {
    if (this._state === 'waiting' || this._state === 'attempting') {
      this.clearTimer()
      this._state = 'paused'
      this._nextRetryAt = null
      if (this._connectionId) {
        this.emit('paused', this._connectionId)
      }
    }
  }

  /** Resume paused reconnection */
  resume(): void {
    if (this._state === 'paused' && this._connectionId) {
      this.emit('resumed', this._connectionId)
      this.scheduleNext()
    }
  }

  /** Skip the wait and attempt immediately. Does NOT reset the whole sequence. */
  retryNow(): void {
    if (!this._connectionId) return

    this.clearTimer()
    this._state = 'attempting'
    this.currentAttempt++
    this._nextRetryAt = null
    this.emit('attempt', this._connectionId, this.currentAttempt)
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
