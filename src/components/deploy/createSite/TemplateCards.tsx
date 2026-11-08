import { Box, Container, File, Hexagon, Plus, Text, type LucideIcon } from 'lucide-react'
import type { ServerTools, TemplateId } from '@/types/createSite'
import { cn } from '@/utils/cn'
import { templateAvailability, type Availability, type AvailabilityState } from '@/utils/createSite/availability'
import { TEMPLATES } from '@/utils/createSite/templates'
import { TEMPLATE_IDS } from '@/utils/createSite/wizard'
import { CardLabel } from '@/components/ssl/Card'

interface TemplateCardsProps {
  value: TemplateId
  tools: ServerTools
  serverLabel: string
  serverName: string
  notHere: Partial<Record<TemplateId, string>>
  onChange: (template: TemplateId) => void
}

const ICONS: Record<TemplateId, LucideIcon> = { laravel: Box, node: Hexagon, static: File, php: Text, compose: Container, blank: Plus }

const AVAILABILITY_TONE: Record<AvailabilityState, string> = {
  ok: 'text-nd-success-fg',
  installs: 'text-nd-warning-fg',
  blocked: 'text-nd-error-fg'
}

function blurb(id: TemplateId, serverLabel: string): string {
  switch (id) {
    case 'laravel': return 'PHP-FPM, public/ as web root, composer, migrations, caches.'
    case 'node': return 'Reverse proxy to your app port, kept alive with pm2.'
    case 'static': return `Files served by ${serverLabel}, as they are or built with npm. Single-page apps too.`
    case 'php': return 'Plain PHP through PHP-FPM, index.php as entry.'
    case 'compose': return `docker compose up on deploy, ${serverLabel} proxies one service.`
    case 'blank': return `Folder and ${serverLabel} site only. You write the commands.`
  }
}

function TemplateCard({ id, selected, tools, serverLabel, notHere, onSelect }: { id: TemplateId; selected: boolean; tools: ServerTools; serverLabel: string; notHere: string | undefined; onSelect: () => void }) {
  const Icon = ICONS[id]
  const availability: Availability = notHere === undefined ? templateAvailability(id, tools) : { state: 'blocked', reason: notHere }
  const blocked = availability.state === 'blocked'
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={blocked}
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-2 rounded-[10px] border p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        selected ? 'border-nd-accent/70 bg-nd-accent/[0.07]' : 'border-nd-border bg-nd-surface enabled:hover:border-nd-border-hover'
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-nd-surface-raised text-nd-accent"><Icon size={16} aria-hidden /></span>
        <b className="text-[13px] font-semibold text-nd-text-primary">{TEMPLATES[id].label}</b>
        {selected && <span className="ml-auto rounded bg-nd-accent/12 px-1.5 py-0.5 text-[11px] font-medium text-nd-accent-hover">selected</span>}
      </div>
      <span className="text-xs text-nd-text-muted">{blurb(id, serverLabel)}</span>
      <span className={cn('flex items-center gap-1.5 text-xs', AVAILABILITY_TONE[availability.state])}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />
        {availability.reason}
      </span>
    </button>
  )
}

export function TemplateCards({ value, tools, serverLabel, serverName, notHere, onChange }: TemplateCardsProps) {
  return (
    <section aria-label="Template" className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2.5">
        <CardLabel>Template</CardLabel>
        <span className="text-xs text-nd-text-muted">checked against what is installed on {serverName}</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
        {TEMPLATE_IDS.map((id) => (
          <TemplateCard key={id} id={id} selected={id === value} tools={tools} serverLabel={serverLabel} notHere={notHere[id]} onSelect={() => onChange(id)} />
        ))}
      </div>
    </section>
  )
}
