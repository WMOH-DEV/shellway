import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { LogEntry, LogLevel, LogSource } from '../../src/types/log'

const DEFAULT_MAX_ENTRIES = 5000

/**
 * LogService — central event-based log aggregator for all connection activity.
 *
 * Stores log entries per session in memory (FIFO with configurable max).
 * Emits 'entry' events with (sessionId, LogEntry) so IPC can forward to renderer.
 */
export class LogService extends EventEmitter {
  private entries: Map<string, LogEntry[]> = new Map()
  private maxEntries: number
  private debugMode: boolean

  constructor(maxEntries: number = DEFAULT_MAX_ENTRIES, debugMode: boolean = false) {
    super()
    this.maxEntries = maxEntries
    this.debugMode = debugMode
  }

  /** Set the maximum number of log entries per session */
  setMaxEntries(max: number): void {
    this.maxEntries = max
  }

  /** Enable or disable debug-level log entries */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled
  }

  /** Add a log entry for a session */
  log(
    sessionId: string,
    level: LogLevel,
    source: LogSource,
    message: string,
    details?: string
  ): LogEntry {
    // Suppress debug-level entries when debug mode is off
    if (level === 'debug' && !this.debugMode) {
      // Still create the entry object so callers get a return value,
      // but don't store or emit it
      return {
        id: randomUUID(),
        timestamp: Date.now(),
        level,
        source,
        message,
        details,
        sessionId
      }
    }

    const entry: LogEntry = {
      id: randomUUID(),
      timestamp: Date.now(),
      level,
      source,
      message,
      details,
      sessionId
    }

    let sessionEntries = this.entries.get(sessionId)
    if (!sessionEntries) {
      sessionEntries = []
      this.entries.set(sessionId, sessionEntries)
    }

    sessionEntries.push(entry)

    // FIFO: discard oldest entries when over max
    while (sessionEntries.length > this.maxEntries) {
      sessionEntries.shift()
    }

    this.emit('entry', sessionId, entry)
    return entry
  }

  /** Get all log entries for a session */
  getEntries(sessionId: string): LogEntry[] {
    return this.entries.get(sessionId) ?? []
  }

  /** Clear all log entries for a session */
  clearEntries(sessionId: string): void {
    this.entries.delete(sessionId)
  }

  /** Export log entries as formatted text */
  exportLog(sessionId: string): string {
    const entries = this.getEntries(sessionId)
    return entries
      .map((e) => {
        const ts = new Date(e.timestamp).toISOString()
        const level = e.level.toUpperCase().padEnd(7)
        const src = e.source.toUpperCase().padEnd(11)
        const detail = e.details ? `\n  ${e.details}` : ''
        return `[${ts}] [${level}] [${src}] ${e.message}${detail}`
      })
      .join('\n')
  }

  // ── Static helper methods for common log messages ──

  static connectionStarted(log: LogService, sessionId: string): void {
    log.log(sessionId, 'info', 'ssh', 'Started a new SSH connection.')
  }

  static connecting(log: LogService, sessionId: string, host: string, port: number): void {
    log.log(sessionId, 'info', 'ssh', `Connecting to SSH server ${host}:${port}...`)
  }

  static handshakeComplete(log: LogService, sessionId: string, fingerprint: string): void {
    log.log(sessionId, 'info', 'ssh', `SSH handshake completed. Server fingerprint: ${fingerprint}`)
  }

  static authenticating(log: LogService, sessionId: string, method: string): void {
    log.log(sessionId, 'info', 'ssh', `Authenticating with method: ${method}...`)
  }

  static authSuccess(log: LogService, sessionId: string): void {
    log.log(sessionId, 'success', 'ssh', 'Authentication successful.')
  }

  static authFailed(log: LogService, sessionId: string, reason: string): void {
    log.log(sessionId, 'error', 'ssh', `Authentication failed: ${reason}`)
  }

  static connected(log: LogService, sessionId: string): void {
    log.log(sessionId, 'success', 'ssh', 'Connection established.')
  }

  static connectionLost(log: LogService, sessionId: string, reason: string): void {
    log.log(sessionId, 'error', 'ssh', `Connection lost: ${reason}`)
  }

  static reconnectionScheduled(log: LogService, sessionId: string, delayMs: number): void {
    const seconds = (delayMs / 1000).toFixed(1)
    log.log(sessionId, 'info', 'ssh', `Next reconnection attempt in ${seconds} second(s).`)
  }

  static reconnecting(log: LogService, sessionId: string, attempt: number, max: number): void {
    const maxStr = max === 0 ? '∞' : String(max)
    log.log(sessionId, 'info', 'ssh', `Reconnecting... (attempt ${attempt} of ${maxStr})`)
  }

  static reconnectionSuccess(log: LogService, sessionId: string, attempt: number): void {
    log.log(sessionId, 'success', 'ssh', `Reconnection successful on attempt ${attempt}.`)
  }

  static reconnectionFailed(log: LogService, sessionId: string, attempt: number, reason: string): void {
    log.log(sessionId, 'error', 'ssh', `Reconnection attempt ${attempt} failed: ${reason}`)
  }

  static reconnectionExhausted(log: LogService, sessionId: string, attempts: number): void {
    log.log(sessionId, 'error', 'ssh', `Reconnection failed after ${attempts} attempts.`)
  }

  static disconnectedByUser(log: LogService, sessionId: string): void {
    log.log(sessionId, 'info', 'ssh', 'Connection aborted by user.')
  }

  static terminated(log: LogService, sessionId: string): void {
    log.log(sessionId, 'info', 'ssh', 'SSH connection terminated.')
  }

  static sftpOpened(log: LogService, sessionId: string): void {
    log.log(sessionId, 'info', 'sftp', 'SFTP subsystem opened.')
  }

  static sftpClosed(log: LogService, sessionId: string): void {
    log.log(sessionId, 'info', 'sftp', 'SFTP subsystem closed.')
  }

  static shellOpened(log: LogService, sessionId: string, shellId: string): void {
    log.log(sessionId, 'info', 'terminal', `Shell channel opened: ${shellId}`)
  }

  static shellClosed(log: LogService, sessionId: string, shellId: string): void {
    log.log(sessionId, 'info', 'terminal', `Shell channel closed: ${shellId}`)
  }

  static transferStarted(log: LogService, sessionId: string, filename: string, direction: string): void {
    log.log(sessionId, 'info', 'sftp', `File transfer started: ${filename} (${direction})`)
  }

  static transferCompleted(log: LogService, sessionId: string, filename: string): void {
    log.log(sessionId, 'success', 'sftp', `File transfer completed: ${filename}`)
  }

  static transferFailed(log: LogService, sessionId: string, filename: string, reason: string): void {
    log.log(sessionId, 'error', 'sftp', `File transfer failed: ${filename} — ${reason}`)
  }

  static hostKeyVerified(log: LogService, sessionId: string, host: string, port: number): void {
    log.log(sessionId, 'info', 'ssh', `Host key verified for ${host}:${port}.`)
  }

  static hostKeyChanged(log: LogService, sessionId: string, oldFp: string, newFp: string): void {
    log.log(
      sessionId,
      'warning',
      'ssh',
      `Host key changed! Previous fingerprint: ${oldFp}, New: ${newFp}`
    )
  }

  static keepAliveSent(log: LogService, sessionId: string): void {
    log.log(sessionId, 'debug', 'ssh', 'Keep-alive sent.')
  }

  static keepAliveTimeout(log: LogService, sessionId: string): void {
    log.log(sessionId, 'warning', 'ssh', 'Keep-alive timeout — connection may be dead.')
  }

  static portForwardStarted(log: LogService, sessionId: string, description: string): void {
    log.log(sessionId, 'info', 'portforward', `Port forwarding started: ${description}`)
  }

  static portForwardStopped(log: LogService, sessionId: string, description: string): void {
    log.log(sessionId, 'info', 'portforward', `Port forwarding stopped: ${description}`)
  }

  static portForwardError(log: LogService, sessionId: string, details: string): void {
    log.log(sessionId, 'error', 'portforward', `Port forwarding error: ${details}`)
  }
}

/** Singleton LogService instance */
let logServiceInstance: LogService | null = null

/** Get (or create) the singleton LogService */
export function getLogService(): LogService {
  if (!logServiceInstance) {
    logServiceInstance = new LogService()
  }
  return logServiceInstance
}
