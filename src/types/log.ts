/** Severity level for a log entry */
export type LogLevel = 'info' | 'warning' | 'error' | 'success' | 'debug'

/** Source subsystem that generated the log entry */
export type LogSource = 'ssh' | 'sftp' | 'terminal' | 'portforward' | 'system'

/** A single log entry for the connection activity log */
export interface LogEntry {
  id: string
  timestamp: number              // Unix ms
  level: LogLevel
  source: LogSource
  message: string
  details?: string               // Expandable details (e.g., full error stack)
  sessionId: string
}
