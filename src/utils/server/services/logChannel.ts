export type SystemLogId = 'journal' | 'journal-errors' | 'nginx-error' | 'nginx-access' | 'apache-error' | 'apache-access' | 'php-fpm' | 'mysql-error' | 'auth' | 'syslog'

export type LogSource =
  | { kind: 'system'; id: SystemLogId }
  | { kind: 'systemd' | 'supervisor' | 'container'; name: string }
  | { kind: 'pm2'; name: string; user: string }

export interface LogReadResult {
  lines: string[]
  missing: boolean
}

export type LogEndReason = 'stopped' | 'ended' | 'missing' | 'limit' | 'error'

export interface LogEnd {
  reason: LogEndReason
  message: string
}

export const LOG_CHANNEL = {
  read: 'server:services:logs-read',
  follow: 'server:services:logs-follow',
  stop: 'server:services:logs-stop',
  chunk: 'server:services:logs-chunk',
  end: 'server:services:logs-end'
} as const
