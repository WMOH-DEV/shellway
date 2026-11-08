import { useEffect, useRef } from 'react'
import { cn } from '@/utils/cn'
import type { SiteLogState } from './useSiteLog'

const ERROR = /\b(ERROR|CRITICAL|EMERGENCY|ALERT|crit|emerg|\[error\])\b/
const WARNING = /\b(WARNING|warn|\[warn\])\b/

function lineTone(line: string): string {
  if (ERROR.test(line)) return 'text-nd-error-fg'
  if (WARNING.test(line)) return 'text-nd-warning-fg'
  return 'text-nd-text-secondary'
}

const MESSAGES = {
  missing: 'This log file does not exist yet.',
  'unknown-site': 'Shellway could not find this site on the server.',
  'no-permission': 'Reading this log needs sudo without a password, and it is not available.'
} as const

export function LogText({ log, className }: { log: SiteLogState; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const text = log.result?.state === 'ok' ? log.result.text : ''

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [text])

  const box = cn('overflow-auto rounded-lg border border-nd-border bg-nd-bg-sunken px-3 py-2 font-mono text-xs leading-[1.7]', className)
  if (log.error) return <div className={box}><span className="text-nd-error-fg">{log.error}</span></div>
  if (!log.result) return <div className={box}><span className="text-nd-text-muted">{log.loading ? 'Reading…' : 'No log selected'}</span></div>
  if (log.result.state !== 'ok') return <div className={box}><span className="text-nd-text-muted">{MESSAGES[log.result.state]}</span></div>
  const lines = text.split('\n').filter((line, index, all) => line !== '' || index < all.length - 1)
  return (
    <div ref={ref} className={box}>
      {lines.length === 0 && <span className="text-nd-text-muted">The log is empty.</span>}
      {lines.map((line, index) => <div key={index} className={cn('whitespace-pre-wrap break-all', lineTone(line))}>{line}</div>)}
    </div>
  )
}
