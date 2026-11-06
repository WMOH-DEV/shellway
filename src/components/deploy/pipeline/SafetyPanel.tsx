import { Input } from '@/components/ui/Input'
import type { SiteConfig } from '@/types/deploy'
import { DEFAULT_QUIET_WINDOW, joinQuietHours, parseQuietHours, type QuietWindow } from '@/utils/deploy/pipelineDraft'
import { SidePanel, SwitchRow } from './SidePanel'

interface SafetyPanelProps {
  draft: SiteConfig
  patch: (changes: Partial<SiteConfig>) => void
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-nd-text-muted">
      {label}
      <input
        type="time"
        className="h-8 rounded-md border border-nd-border bg-nd-bg-primary px-2 text-sm text-nd-text-primary hover:border-nd-border-hover focus:border-nd-accent focus:outline-none focus:ring-1 focus:ring-nd-accent"
        value={value}
        onChange={(e) => e.target.value && onChange(e.target.value)}
      />
    </label>
  )
}

function QuietHours({ draft, patch }: SafetyPanelProps) {
  const range = parseQuietHours(draft.quietHours) ?? DEFAULT_QUIET_WINDOW
  const automatic = draft.sourceMode === 'auto'
  const setWindow = (changes: Partial<QuietWindow>) => patch({ quietHours: joinQuietHours({ ...range, ...changes }) })

  return (
    <>
      <SwitchRow
        checked={draft.quietHours !== ''}
        onChange={(on) => patch({ quietHours: on ? joinQuietHours(DEFAULT_QUIET_WINDOW) : '' })}
        disabled={!automatic}
        title="Quiet hours"
        hint={automatic ? 'Auto deploys wait until the window ends. Manual deploys are not affected.' : 'Only for sites that deploy automatically on the server.'}
      />
      {automatic && draft.quietHours !== '' && (
        <div className="flex flex-col gap-1.5 pl-[46px]">
          <div className="flex flex-wrap items-center gap-3">
            <TimeField label="From" value={range.from} onChange={(from) => setWindow({ from })} />
            <TimeField label="To" value={range.to} onChange={(to) => setWindow({ to })} />
          </div>
          <span className="text-2xs text-nd-text-muted">Server time. A window like 22:00 to 06:00 runs past midnight.</span>
        </div>
      )}
    </>
  )
}

export function SafetyPanel({ draft, patch }: SafetyPanelProps) {
  return (
    <SidePanel title="Safety">
      <SwitchRow
        checked={draft.approveMigrations}
        onChange={(approveMigrations) => patch({ approveMigrations })}
        title="Ask before new migrations"
        hint="Waits for your approval when commits add or change a migration."
      />
      {draft.approveMigrations && (
        <div className="pl-[46px]">
          <Input
            aria-label="Migrations folder"
            className="h-[30px] font-mono text-xs"
            value={draft.migrationsPath}
            onChange={(e) => patch({ migrationsPath: e.target.value.trim() })}
          />
        </div>
      )}
      <QuietHours draft={draft} patch={patch} />
    </SidePanel>
  )
}
