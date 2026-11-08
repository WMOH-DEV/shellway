import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { SslReport } from '@/types/ssl'
import { AlertsCard } from './AlertsCard'
import { CloudflareCard } from './CloudflareCard'
import { ServerChecksCard } from './ServerChecksCard'

export interface SslSettingsProps {
  connectionId: string
  report: SslReport | null
  checking: boolean
  onBack: () => void
  onRecheck: () => void
  onCloudflareChanged: () => void
  onSetZoneStrict: (zone: string) => void
}

const COLUMNS = { gridTemplateColumns: 'repeat(auto-fit, minmax(min(480px, 100%), 1fr))' }

export function SslSettings({ report, checking, onBack, onRecheck, onCloudflareChanged, onSetZoneStrict }: SslSettingsProps) {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-nd-bg-primary">
      <header className="flex items-center gap-2.5 border-b border-nd-border px-7 py-4">
        <Button size="icon" variant="ghost" aria-label="Back to hostnames" onClick={onBack}><ArrowLeft size={16} /></Button>
        <h1 className="text-lg font-semibold text-nd-text-primary">SSL settings</h1>
        <span className="text-[13px] text-nd-text-muted">Cloudflare access and what this server can do</span>
      </header>
      <div className="grid items-start gap-5 px-7 py-6" style={COLUMNS}>
        <CloudflareCard hostnames={report?.hostnames ?? []} onChanged={onCloudflareChanged} onSetZoneStrict={onSetZoneStrict} />
        <div className="flex flex-col gap-5">
          <ServerChecksCard report={report} checking={checking} onRecheck={onRecheck} />
          <AlertsCard />
        </div>
      </div>
    </div>
  )
}
