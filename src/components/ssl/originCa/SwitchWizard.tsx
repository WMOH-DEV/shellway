import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { HostnameStatus, SslReport } from '@/types/ssl'
import { ApplyStep } from './ApplyStep'
import { ExplainStep } from './ExplainStep'
import { OrangeCloudCard } from './OrangeCloudCard'
import { PrepareStep } from './PrepareStep'
import { ReviewStep } from './ReviewStep'
import { SwitchFooter } from './SwitchFooter'
import { SwitchStepper } from './SwitchStepper'
import { useSwitchFlow, type SwitchFlow } from './useSwitchFlow'

interface SwitchWizardProps {
  connectionId: string
  sessionId: string
  report: SslReport
  host: HostnameStatus
  onCancel: () => void
  onFinished: () => void
}

function StepBody({ flow, report, host }: { flow: SwitchFlow; report: SslReport; host: HostnameStatus }) {
  if (flow.phase === 'prepare') return <PrepareStep flow={flow} />
  if (flow.phase === 'review' && flow.prepared) return <ReviewStep flow={flow} report={report} prepared={flow.prepared} />
  if (flow.phase === 'apply') return <ApplyStep flow={flow} />
  return <ExplainStep flow={flow} report={report} host={host} />
}

export function SwitchWizard({ connectionId, sessionId, report, host, onCancel, onFinished }: SwitchWizardProps) {
  const flow = useSwitchFlow({ connectionId, sessionId, report, hostName: host.name, blockId: host.blockId })
  const leave = () => {
    flow.abandon()
    onCancel()
  }
  const changed = flow.finished || flow.undo.result !== null
  return (
    <div className="flex h-full flex-col bg-nd-bg-primary">
      <header className="flex items-center gap-2.5 border-b border-nd-border px-7 py-4">
        <Button size="icon" variant="ghost" aria-label="Leave the switch" disabled={flow.busy} onClick={changed ? onFinished : leave}>
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-lg font-semibold text-nd-text-primary">Switch to Cloudflare Origin CA</h1>
        <span className="font-mono text-sm text-nd-text-muted">{host.name}</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="flex min-h-full items-stretch gap-8 px-7 py-6">
          <aside className="flex w-[260px] shrink-0 flex-col gap-5">
            <SwitchStepper current={flow.step} details={flow.details} />
            <OrangeCloudCard />
          </aside>
          <main className="min-w-0 flex-1">
            <StepBody flow={flow} report={report} host={host} />
          </main>
        </div>
      </div>

      <SwitchFooter flow={flow} onCancel={leave} onFinished={onFinished} />
    </div>
  )
}
