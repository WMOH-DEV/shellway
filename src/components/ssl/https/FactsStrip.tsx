import type { PrepFacts } from '@/types/ssl'
import { factViews } from '@/utils/ssl/addHttps/prepView'
import { CardLabel } from '../Card'
import { TONE_FILL } from '../tones'

export function FactsStrip({ facts }: { facts: PrepFacts }) {
  return (
    <section aria-label="What Shellway found" className="flex flex-wrap gap-x-7 gap-y-3 rounded-[10px] border border-nd-border bg-nd-bg-secondary p-4">
      {factViews(facts).map((fact) => (
        <div key={fact.label} className="flex min-w-[120px] flex-col gap-1">
          <CardLabel>{fact.label}</CardLabel>
          <span className="flex items-center gap-1.5 text-[13px] text-nd-text-primary">
            <span aria-hidden className={`h-[7px] w-[7px] rounded-full ${TONE_FILL[fact.tone]}`} />
            {fact.value}
          </span>
          <span className="text-xs text-nd-text-muted">{fact.sub}</span>
        </div>
      ))}
    </section>
  )
}
