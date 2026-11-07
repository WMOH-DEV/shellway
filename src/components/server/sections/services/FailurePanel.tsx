import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import type { HintFix, ServiceHint } from '@/utils/server/services/hints'
import { guessPriority } from '@/utils/server/services/logLines'
import { CodeBox } from '../../kit'

export interface FailurePanelProps {
  lines: string[]
  hint: ServiceHint | null
  usedBy: string[]
  onFix(fix: HintFix): void
}

function JournalLines({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null
  return (
    <div className="flex max-h-64 flex-col overflow-auto rounded-lg border border-nd-border bg-nd-bg-sunken px-3 py-2.5 font-mono text-xs leading-[1.7] text-nd-text-secondary">
      {lines.map((line, index) => (
        <span key={index} className={cn('whitespace-pre-wrap break-all', guessPriority(line) === 'err' && 'text-nd-error-fg')}>{line}</span>
      ))}
    </div>
  )
}

function HintRow({ hint, onFix, onShow }: { hint: ServiceHint; onFix(fix: HintFix): void; onShow(text: string): void }) {
  const fix = hint.fix
  return (
    <div className="flex items-center gap-2.5 text-[13px] text-nd-text-secondary">
      <span className="min-w-0 flex-1">{hint.text}</span>
      {fix && (
        <Button size="sm" variant={fix.kind === 'show' || fix.kind === 'logs' ? 'secondary' : 'primary'} onClick={() => (fix.kind === 'show' ? onShow(fix.text) : onFix(fix))}>
          {fix.label}
        </Button>
      )}
    </div>
  )
}

export function FailurePanel({ lines, hint, usedBy, onFix }: FailurePanelProps) {
  const [shown, setShown] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-2 pb-3.5 pl-[52px] pr-4">
      <JournalLines lines={lines} />
      {lines.length === 0 && !hint && <span className="text-xs text-nd-text-muted">No recent log lines. Open the logs for more.</span>}
      {hint && <HintRow hint={hint} onFix={onFix} onShow={(text) => setShown((current) => (current === text ? null : text))} />}
      {shown && <CodeBox text={shown} label="output" />}
      {usedBy.length > 0 && <span className="text-xs text-nd-text-muted">Used by {usedBy.join(', ')}.</span>}
    </div>
  )
}
