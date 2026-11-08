import { useMemo } from 'react'
import { Copy, Info } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { copyText } from '@/components/deploy/copyText'
import { cn } from '@/utils/cn'
import { parseRunLog } from '@/utils/deploy/runLog'
import type { RenewalInfo } from '@/types/ssl'
import { renewalHint } from '@/utils/ssl/renewalHint'
import { formatDateTime } from '@/utils/ssl/time'
import type { Tone } from '@/utils/ssl/tone'
import { Card } from '../Card'
import { TONE_BADGE } from '../tones'

const RESULT_CHIP: Record<RenewalInfo['lastResult'], { label: string; tone: Tone }> = {
  success: { label: 'ok', tone: 'success' },
  failed: { label: 'failed', tone: 'error' },
  unknown: { label: 'unknown', tone: 'neutral' }
}

function OutputLines({ output }: { output: string }) {
  const lines = useMemo(() => parseRunLog(output).sections.flatMap((section) => section.lines), [output])
  if (lines.length === 0) return <div className="text-nd-text-muted">No output recorded</div>
  return (
    <>
      {lines.map((line) => (
        <div key={line.n} data-tone={line.tone} className={cn('-mx-3 whitespace-pre-wrap break-words px-3', line.tone === 'error' ? 'bg-nd-error/10 text-nd-error-fg' : line.tone === 'warning' ? 'text-nd-warning-fg' : 'text-nd-text-secondary')}>
          {line.text}
        </div>
      ))}
    </>
  )
}

function Hint({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 text-[13px] text-nd-text-secondary">
      <Info size={15} className="mt-px shrink-0 text-nd-info-fg" />
      <span>{text}</span>
    </div>
  )
}

export function RenewalCard({ renewal }: { renewal: RenewalInfo }) {
  const chip = RESULT_CHIP[renewal.lastResult]
  const hint = renewal.lastResult === 'failed' ? renewalHint(renewal.output) : null
  const title = renewal.lastRun === null ? 'Last renewal' : `Last renewal · ${formatDateTime(renewal.lastRun)}`
  return (
    <Card
      label={title}
      ariaLabel="Last renewal attempt"
      aside={
        <>
          <Badge variant={TONE_BADGE[chip.tone]}>{chip.label}</Badge>
          <Button size="icon" variant="ghost" aria-label="Copy output" className="h-7 w-7" disabled={!renewal.output} onClick={() => copyText(renewal.output, 'Output copied')}>
            <Copy size={14} />
          </Button>
        </>
      }
    >
      <div className="max-h-72 overflow-auto rounded-lg border border-nd-border bg-nd-bg-sunken px-3 py-2.5 font-mono text-xs leading-[1.7]">
        <OutputLines output={renewal.output} />
      </div>
      {hint && <Hint text={hint} />}
    </Card>
  )
}
