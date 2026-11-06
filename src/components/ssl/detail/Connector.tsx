import { cn } from '@/utils/cn'
import type { ConnectorView } from '@/utils/ssl/diagram'
import { TONE_FILL, TONE_LINE, TONE_TEXT } from '../tones'

export function Connector({ view }: { view: ConnectorView }) {
  return (
    <div data-state={view.failing ? 'failing' : 'ok'} className="flex flex-col items-center gap-1 px-1.5">
      <span className={cn('h-4 font-mono text-[11px]', TONE_TEXT[view.tone])}>{view.protocol}</span>
      {view.failing
        ? <div data-line="dashed" className={cn('w-full border-t-2 border-dashed', TONE_LINE[view.tone])} />
        : <div data-line="solid" className={cn('h-0.5 w-full rounded-sm', TONE_FILL[view.tone])} />}
      <span className="text-center text-[11px] text-nd-text-muted">{view.label}</span>
    </div>
  )
}
