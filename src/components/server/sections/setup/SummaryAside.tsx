import type { SetupSummary } from '@/utils/server/setup/plan'
import { Label } from '../../kit'

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

export function SummaryAside({ summary, onCreateSite }: { summary: SetupSummary; onCreateSite(): void }) {
  return (
    <aside className="flex max-w-[340px] flex-[1_1_280px] flex-col gap-3">
      <section aria-label="Summary" className="flex flex-col gap-3 rounded-xl border border-nd-border bg-nd-surface p-4">
        <Label>Summary</Label>
        <div className="flex flex-col gap-2 text-[13px] text-nd-text-secondary">
          <span>{plural(summary.installCount, 'component')} to install</span>
          <span>{plural(summary.securityCount, 'security change')}</span>
          <span>About {plural(summary.minutes, 'minute')}</span>
          <span>System packages are updated first</span>
        </div>
        <span className="h-px bg-nd-border" />
        <span className="text-xs text-nd-text-muted">
          Needs root or full passwordless sudo. The firewall allows your current SSH port before it turns on, and SSH password login stays on unless you turn it off.
        </span>
      </section>
      <section aria-label="After this" className="flex flex-col gap-2 rounded-xl border border-nd-border bg-nd-surface p-4">
        <Label>After this</Label>
        <span className="text-[13px] text-nd-text-secondary">Create your first site: folder, web server, DNS, HTTPS and deploys in one flow.</span>
        <button type="button" onClick={onCreateSite} className="self-start text-[13px] text-nd-accent hover:underline">Go to Sites</button>
      </section>
    </aside>
  )
}
