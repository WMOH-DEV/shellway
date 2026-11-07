import { cronLogPath } from './crontab'
import { quote } from './shell'
import { oneOf, PM2_NAME, PROCESS_NAME, record, TASK_ID, text, USER_NAME } from './validate'

export type LogTarget =
  | { kind: 'supervisor'; process: string }
  | { kind: 'pm2'; user: string; app: string }
  | { kind: 'cron'; id: string }

const KINDS = ['supervisor', 'pm2', 'cron'] as const
const MAX_BYTES = 65536

export function validateLogTarget(raw: unknown): LogTarget {
  const input = record(raw)
  const kind = oneOf(input, 'kind', KINDS)
  if (kind === 'supervisor') return { kind, process: text(input, 'process', PROCESS_NAME, 'The worker') }
  if (kind === 'pm2') return { kind, user: text(input, 'user', USER_NAME, 'The user'), app: text(input, 'app', PM2_NAME, 'The app') }
  return { kind, id: text(input, 'id', TASK_ID, 'The task') }
}

const AS_ROOT = 'if [ "$(id -u)" -eq 0 ]; then R=env; else R="sudo -n"; fi'

function readCommand(target: LogTarget): string {
  if (target.kind === 'supervisor') return `$R supervisorctl tail -${MAX_BYTES} ${quote(target.process)} stdout`
  if (target.kind === 'cron') return `$R tail -c ${MAX_BYTES} ${cronLogPath(target.id)}`
  const pm2 = `pm2 logs ${quote(target.app)} --nostream --raw --lines 200`
  return `if [ "$(id -un)" = ${quote(target.user)} ]; then ${pm2}; else sudo -n -u ${quote(target.user)} -H ${pm2}; fi`
}

export function logTailScript(target: LogTarget): string {
  return `${AS_ROOT}\n${readCommand(target)} 2>&1 | tail -c ${MAX_BYTES}\n`
}
