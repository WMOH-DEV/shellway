import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { Input } from '@/components/ui/Input'
import { CardLabel } from '../Card'
import { OTHER_SITE, type SiteSelection } from './useSiteSelection'

const KIND_CHIP = {
  deploy: { label: 'Deploy site', style: 'bg-nd-accent/[.12] text-nd-accent' },
  nginx: { label: 'nginx', style: 'bg-nd-bg-tertiary text-nd-text-muted' }
} as const

function Radio({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px]', on ? 'border-nd-accent' : 'border-nd-text-muted')}>
      {on && <span className="h-2 w-2 rounded-full bg-nd-accent" />}
    </span>
  )
}

function OptionButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 rounded-[10px] border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent',
        on ? 'border-nd-accent/70 bg-nd-accent/[.07]' : 'border-nd-border bg-nd-bg-secondary hover:bg-nd-bg-tertiary'
      )}
    >
      <Radio on={on} />
      <span className="flex min-w-0 flex-col gap-0.5">{children}</span>
    </button>
  )
}

export function SitePicker({ site }: { site: SiteSelection }) {
  return (
    <section aria-label="Site" className="flex flex-col gap-2">
      <CardLabel>Site</CardLabel>
      <div role="group" aria-label="Choose a site" className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-2">
        {site.options.map((option) => {
          const chip = KIND_CHIP[option.kind]
          return (
            <OptionButton key={option.id} on={site.choice === option.id} onClick={() => site.choose(option.id)}>
              <span className="flex items-center gap-2">
                <span className="truncate text-[13px] font-semibold text-nd-text-primary">{option.title}</span>
                <span className={cn('rounded px-1.5 py-px text-[11px] font-medium', chip.style)}>{chip.label}</span>
              </span>
              <span className="truncate font-mono text-xs text-nd-text-muted">{option.detail}</span>
            </OptionButton>
          )
        })}
        <OptionButton on={site.choice === OTHER_SITE} onClick={() => site.choose(OTHER_SITE)}>
          <span className="text-[13px] font-semibold text-nd-text-primary">Other hostname…</span>
          <span className="text-xs text-nd-text-muted">Must match an nginx server block</span>
        </OptionButton>
      </div>
      {site.choice === OTHER_SITE && (
        <div className="max-w-sm">
          <Input
            label="Hostname"
            className="bg-nd-bg-primary font-mono text-xs"
            placeholder="blog.example.com"
            spellCheck={false}
            autoComplete="off"
            value={site.otherText}
            error={site.otherError ?? undefined}
            onChange={(e) => site.setOtherText(e.target.value)}
          />
        </div>
      )}
    </section>
  )
}
