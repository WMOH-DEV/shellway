import type { MouseEvent } from 'react'
import { ChevronRight, Cloud } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { HostnameStatus, ServerFacts } from '@/types/ssl'
import { certView, edgeView, renewalView, verdictBadge } from '@/utils/ssl/hostRow'
import { CLOUDFLARE_ORANGE, TONE_FILL, TONE_INK } from './tones'
import { VerdictBadge } from './VerdictBadge'

export const SSL_COLUMNS =
  'grid-cols-[minmax(0,1.5fr)_minmax(0,1.35fr)_44px] gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.35fr)_minmax(0,1.15fr)_minmax(0,1.25fr)_44px]'

interface HostRowProps {
  host: HostnameStatus
  facts: ServerFacts
  now: number
  onOpen: (name: string) => void
}

function HostCell({ host, onOpen }: { host: HostnameStatus; onOpen: () => void }) {
  const open = (e: MouseEvent) => { e.stopPropagation(); onOpen() }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={open}
          className="truncate rounded text-left font-mono text-[13px] font-medium text-nd-text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent"
        >
          {host.name}
        </button>
        <VerdictBadge view={verdictBadge(host)} className="shrink-0" />
      </div>
      <span className="truncate text-xs text-nd-text-muted">{host.reason}</span>
    </div>
  )
}

function CertCell({ host, now }: { host: HostnameStatus; now: number }) {
  const view = certView(host, now)
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[13px] text-nd-text-primary">
        <span className="truncate">{view.kindLabel}</span>
        <span className={cn('ml-auto shrink-0 text-xs', TONE_INK[view.tone])}>{view.daysText}</span>
      </div>
      <div className="flex h-1 rounded-sm bg-nd-bg-tertiary" role="img" aria-label={`${Math.round(view.life * 100)}% of the certificate lifetime left`}>
        <span className={cn('rounded-sm', TONE_FILL[view.tone])} style={{ width: `${view.life * 100}%` }} />
      </div>
    </div>
  )
}

function CloudflareCell({ host }: { host: HostnameStatus }) {
  const view = edgeView(host.edge)
  return (
    <div className="hidden min-w-0 flex-col gap-0.5 lg:flex">
      <span className="flex items-center gap-1.5 text-[13px] text-nd-text-primary">
        <Cloud size={15} className="shrink-0 text-nd-text-muted" style={view.proxied ? { color: CLOUDFLARE_ORANGE } : undefined} aria-hidden />
        <span className="truncate">{view.label}</span>
      </span>
      <span className="truncate text-xs text-nd-text-muted">{view.detail}</span>
    </div>
  )
}

function RenewalCell({ host, facts, now }: { host: HostnameStatus; facts: ServerFacts; now: number }) {
  const view = renewalView(host, facts, now)
  return (
    <div className="hidden min-w-0 flex-col gap-0.5 lg:flex">
      <span className={cn('truncate text-[13px]', TONE_INK[view.tone])}>{view.title}</span>
      <span className="truncate text-xs text-nd-text-muted">{view.sub}</span>
    </div>
  )
}

export function HostRow({ host, facts, now, onOpen }: HostRowProps) {
  const open = () => onOpen(host.name)
  return (
    <div
      onClick={open}
      className={cn(
        'grid cursor-pointer items-center px-4 py-3 transition-colors hover:bg-nd-bg-tertiary',
        SSL_COLUMNS
      )}
    >
      <HostCell host={host} onOpen={open} />
      <CertCell host={host} now={now} />
      <CloudflareCell host={host} />
      <RenewalCell host={host} facts={facts} now={now} />
      <span className="flex h-8 w-8 items-center justify-center justify-self-center text-nd-text-muted" aria-hidden>
        <ChevronRight size={16} />
      </span>
    </div>
  )
}
