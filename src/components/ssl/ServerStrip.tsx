import type { ServerFacts } from '@/types/ssl'
import { serverStrip } from '@/utils/ssl/serverStrip'
import { TONE_FILL } from './tones'

interface ServerStripProps {
  facts: ServerFacts
  now: number
  onOpenSettings: () => void
}

export function ServerStrip({ facts, now, onOpenSettings }: ServerStripProps) {
  return (
    <section aria-label="Server" className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[10px] border border-nd-border bg-nd-bg-secondary px-3.5 py-2.5 text-[13px] text-nd-text-secondary">
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-nd-text-muted">Server</span>
      {serverStrip(facts, now).map((item) => (
        <span key={item.key} className="flex items-center gap-1.5">
          {item.tone !== 'neutral' && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_FILL[item.tone]}`} />}
          {item.parts.map((part) => (
            <span key={part.text} className={part.mono ? 'font-mono text-xs text-nd-text-muted' : undefined}>{part.text}</span>
          ))}
        </span>
      ))}
      <div className="flex-1" />
      <button type="button" onClick={onOpenSettings} className="rounded text-xs text-nd-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent">
        Server checks
      </button>
    </section>
  )
}
