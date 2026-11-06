import { ArrowLeft, ArrowRight, Play, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { SiteConfig } from '@/types/deploy'
import { requiredLeftLabel } from '@/utils/deploy/readyCheck'
import { firstDeployPlan } from '@/utils/deploy/setupFlow'
import { ReadyCheck } from './ReadyCheck'
import { FirstDeployCard, Stepper } from './SetupSidebar'
import { CodeSection, CommandsSection, LayoutSection, SafetySection, WhereSection } from './SiteSections'
import { useSetupFlow, type SetupFlow } from './useSetupFlow'

interface SetupWizardProps {
  connectionId: string
  existingNames: string[]
  onCancel: () => void
  onSiteSaved: (site: SiteConfig) => void
  onFinished: (site: SiteConfig) => void
}

function StepBody({ flow, connectionId }: { flow: SetupFlow; connectionId: string }) {
  const { draft, step } = flow
  if (step === 'where') return <WhereSection draft={draft} />
  if (step === 'code') return <CodeSection draft={draft} />
  if (step === 'layout') return <LayoutSection draft={draft} />
  if (step === 'commands') {
    return (
      <div className="flex flex-col gap-4">
        <CommandsSection draft={draft} connectionId={connectionId} />
        <SafetySection draft={draft} />
      </div>
    )
  }
  return <ReadyCheck model={flow.ready} />
}

function ReadyFooter({ flow }: { flow: SetupFlow }) {
  const { ready, busy } = flow
  const canDeploy = !!ready.summary?.ready && !ready.running && !busy
  return (
    <>
      <span className="text-xs text-nd-text-muted">{ready.summary ? requiredLeftLabel(ready.summary.requiredLeft) : 'Checking…'}</span>
      <Button onClick={() => void ready.run()} disabled={ready.running || busy}>
        <RefreshCw size={13} /> Check again
      </Button>
      <Button variant="primary" onClick={() => void flow.deploy()} disabled={!canDeploy}>
        <Play size={13} /> {busy ? 'Starting…' : 'Deploy for the first time'}
      </Button>
    </>
  )
}

function StepFooter({ flow }: { flow: SetupFlow }) {
  const nextLabel = flow.step === 'commands' ? 'Save and check the server' : 'Next'
  return (
    <Button variant="primary" onClick={() => void flow.next()} disabled={flow.busy}>
      {flow.busy ? 'Saving…' : nextLabel} <ArrowRight size={13} />
    </Button>
  )
}

function Footer({ flow }: { flow: SetupFlow }) {
  return (
    <footer className="flex flex-wrap items-center gap-2.5 border-t border-nd-border bg-nd-bg-secondary px-7 py-3">
      <Button onClick={flow.back} disabled={flow.busy}>{flow.step === 'where' ? 'Cancel' : 'Back'}</Button>
      <div className="flex-1" />
      {flow.error && <span className="max-w-[50%] truncate text-xs text-nd-error-fg" title={flow.error}>{flow.error}</span>}
      {flow.step === 'ready' ? <ReadyFooter flow={flow} /> : <StepFooter flow={flow} />}
    </footer>
  )
}

export function SetupWizard({ connectionId, existingNames, onCancel, onSiteSaved, onFinished }: SetupWizardProps) {
  const flow = useSetupFlow({ connectionId, existingNames, onCancel, onSiteSaved, onFinished })
  const { site } = flow.draft

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2.5 border-b border-nd-border px-7 py-4">
        <Button size="icon" variant="ghost" aria-label="Back to sites" onClick={onCancel}><ArrowLeft size={16} /></Button>
        <h1 className="text-lg font-semibold text-nd-text-primary">Add site</h1>
        {site.name && <span className="text-sm text-nd-text-muted">{site.name}</span>}
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="flex min-h-full items-stretch gap-8 px-7 py-6">
          <aside className="flex w-[260px] shrink-0 flex-col gap-5">
            <Stepper current={flow.step} details={flow.details} onSelect={flow.goTo} />
            <FirstDeployCard plan={firstDeployPlan(site)} />
          </aside>
          <main className="min-w-0 max-w-3xl flex-1">
            <StepBody flow={flow} connectionId={connectionId} />
          </main>
        </div>
      </div>

      <Footer flow={flow} />
    </div>
  )
}
