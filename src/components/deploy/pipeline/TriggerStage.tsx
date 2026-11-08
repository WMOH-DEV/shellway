import { GitBranch, Laptop, Server } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Toggle } from '@/components/ui/Toggle'
import { cn } from '@/utils/cn'
import type { SiteConfig, SourceMode } from '@/types/deploy'
import { pollChoices } from '@/utils/deploy/pipelineDraft'

interface TriggerStageProps {
  draft: SiteConfig
  savedSourceMode: SourceMode
  patch: (changes: Partial<SiteConfig>) => void
  onOpenServerCheck: () => void
}

const SOURCES = [
  { mode: 'auto', icon: Server, title: 'Auto on the server', hint: 'Deploys by itself, even when your PC is off. The server holds a read-only key for this repo.' },
  { mode: 'pc', icon: Laptop, title: 'From my PC', hint: 'Shellway sends the code over SSH. The server never touches your git host.' }
] as const

function SourceCard({ mode, icon: Icon, title, hint, active, onSelect }: (typeof SOURCES)[number] & { active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors',
        active ? 'border-nd-accent/70 bg-nd-accent/[0.07]' : 'border-nd-border hover:border-nd-border-hover'
      )}
      data-mode={mode}
    >
      <Icon size={16} className={cn('mt-0.5 shrink-0', active ? 'text-nd-info' : 'text-nd-text-muted')} />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-nd-text-primary">{title}</span>
        <span className="text-xs text-nd-text-muted">{hint}</span>
      </span>
    </button>
  )
}

export function TriggerStage({ draft, savedSourceMode, patch, onOpenServerCheck }: TriggerStageProps) {
  const switchedToAuto = draft.sourceMode === 'auto' && savedSourceMode !== 'auto'
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SOURCES.map((source) => (
          <SourceCard key={source.mode} {...source} active={draft.sourceMode === source.mode} onSelect={() => patch({ sourceMode: source.mode })} />
        ))}
      </div>
      {switchedToAuto && (
        <div className="text-xs text-nd-warning-fg">
          Auto deploys need the server's read-only deploy key.{' '}
          <button type="button" className="text-nd-info-fg hover:underline" onClick={onOpenServerCheck}>Open server check</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2.5 text-xs text-nd-text-muted">
        <span>Watch</span>
        <div className="w-40">
          <Input
            aria-label="Branch"
            className="h-[30px] font-mono text-xs"
            icon={<GitBranch size={13} />}
            value={draft.branch}
            onChange={(e) => patch({ branch: e.target.value.trim() })}
          />
        </div>
        {draft.sourceMode === 'auto' ? (
          <>
            <span>check every</span>
            <div className="w-28">
              <Select
                aria-label="Check interval"
                className="h-[30px] text-xs"
                value={String(draft.pollMinutes)}
                options={pollChoices(draft.pollMinutes).map((minutes) => ({ value: String(minutes), label: `${minutes} min` }))}
                onChange={(e) => patch({ pollMinutes: Number(e.target.value) })}
              />
            </div>
          </>
        ) : (
          <Toggle
            className="ml-auto"
            checked={draft.pcAuto}
            onChange={(pcAuto) => patch({ pcAuto })}
            label="Deploy new commits while Shellway is open"
          />
        )}
      </div>
    </div>
  )
}
