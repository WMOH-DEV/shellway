import { useMemo } from 'react'
import { Check, Copy, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { parseRunLog } from '@/utils/deploy/runLog'
import { copyText } from '@/components/deploy/copyText'
import { LogViewer } from '@/components/deploy/detail/LogViewer'

interface PanelOutcome {
  success: boolean
  message: string
}

interface OutputPanelProps {
  command: string
  output: string
  running: boolean
  outcome: PanelOutcome | null
}

function OutcomeLine({ outcome }: { outcome: PanelOutcome }) {
  const Icon = outcome.success ? Check : X
  return (
    <span role="status" className={cn('flex items-center gap-1.5 text-xs font-medium', outcome.success ? 'text-nd-success-fg' : 'text-nd-error-fg')}>
      <Icon size={13} /> {outcome.message}
    </span>
  )
}

export function OutputPanel({ command, output, running, outcome }: OutputPanelProps) {
  const sections = useMemo(() => parseRunLog(output).sections, [output])
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-nd-text-muted">{command}</span>
        {running && <span className="flex items-center gap-1.5 text-xs text-nd-info-fg"><Loader2 size={13} className="animate-spin" /> Running…</span>}
        {outcome && <OutcomeLine outcome={outcome} />}
        <Button size="icon" variant="ghost" aria-label="Copy output" className="h-7 w-7" disabled={!output} onClick={() => copyText(output, 'Output copied')}>
          <Copy size={13} />
        </Button>
      </div>
      <div className="flex h-64 flex-col">
        <LogViewer sections={sections} skipped={[]} live={running} focusKey={null} focusRequest={0} empty={running ? 'Starting…' : 'No output'} />
      </div>
    </div>
  )
}
