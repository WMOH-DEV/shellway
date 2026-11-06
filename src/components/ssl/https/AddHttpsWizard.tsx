import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { SslReport } from '@/types/ssl'
import { ContextCard } from './ContextCard'
import { HttpsStepper } from './HttpsStepper'
import { IssueStep } from './IssueStep'
import { PrepareStep } from './PrepareStep'
import { SiteStep } from './SiteStep'
import { VerifyStep } from './VerifyStep'
import { WizardFooter } from './WizardFooter'
import { useAddHttpsFlow, type AddHttpsFlow } from './useAddHttpsFlow'

interface AddHttpsWizardProps {
  connectionId: string
  sessionId: string
  serverName: string
  report: SslReport
  blockId: string | null
  onCancel: () => void
  onFinished: () => void
}

function StepBody({ flow, report }: { flow: AddHttpsFlow; report: SslReport }) {
  if (flow.step === 'site') return <SiteStep flow={flow} />
  if (flow.step === 'prepare') return <PrepareStep prepare={flow.prepare} />
  if (flow.step === 'issue') return <IssueStep flow={flow} report={report} />
  return <VerifyStep verify={flow.verify} />
}

export function AddHttpsWizard({ connectionId, sessionId, serverName, report, blockId, onCancel, onFinished }: AddHttpsWizardProps) {
  const flow = useAddHttpsFlow({ connectionId, sessionId, report, initialBlockId: blockId })
  const busy = flow.prepare.run.running || flow.issue.run.running
  return (
    <div className="flex h-full flex-col bg-nd-bg-primary">
      <header className="flex items-center gap-2.5 border-b border-nd-border px-7 py-4">
        <Button size="icon" variant="ghost" aria-label="Leave Add HTTPS" disabled={busy} onClick={flow.step === 'verify' ? onFinished : onCancel}>
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-lg font-semibold text-nd-text-primary">Add HTTPS</h1>
        <span className="text-sm text-nd-text-muted">to a site on {serverName}</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="flex min-h-full items-stretch gap-8 px-7 py-6">
          <aside className="flex w-[260px] shrink-0 flex-col gap-5">
            <HttpsStepper
              current={flow.step}
              details={flow.details}
              prepareSkipped={flow.prepareSkipped}
              canNavigate={flow.step !== 'verify' && !busy}
              onSelect={flow.goTo}
            />
            <ContextCard step={flow.step} certbotDocsUrl={flow.prepare.plan?.docsUrl ?? null} route={flow.prepare.plan?.route ?? null} />
          </aside>
          <main className="min-w-0 flex-1">
            <StepBody flow={flow} report={report} />
          </main>
        </div>
      </div>

      <WizardFooter flow={flow} onCancel={onCancel} onFinished={onFinished} />
    </div>
  )
}
