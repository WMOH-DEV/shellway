import { useMemo } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { parseRunLog } from '@/utils/deploy/runLog'
import { copyText } from '../copyText'
import { LogViewer } from '../detail/LogViewer'

interface RunOutputProps {
  title: string
  output: string
  live: boolean
}

export function RunOutput({ title, output, live }: RunOutputProps) {
  const sections = useMemo(() => parseRunLog(output).sections, [output])
  return (
    <section aria-label="Live output" className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-nd-text-primary">{title}</span>
        <div className="flex-1" />
        <Button size="icon" variant="ghost" aria-label="Copy output" className="h-7 w-7" disabled={!output} onClick={() => void copyText(output, 'Output copied')}>
          <Copy size={13} />
        </Button>
      </div>
      <LogViewer sections={sections} skipped={[]} live={live} focusKey={null} focusRequest={0} empty={live ? 'Waiting for output…' : 'No output in this window yet'} />
    </section>
  )
}
