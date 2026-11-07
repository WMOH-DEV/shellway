import { useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { CreateSiteInput, PlanAction, RunRecord } from '@/types/createSite'
import { hasServer } from '@/utils/createSite/wizard'
import { Callout } from './Callout'
import { RunScreen } from './RunScreen'
import { SetupFlow, type SetupFlowProps } from './SetupFlow'
import { useCreateRun } from './useCreateRun'
import { useCreateSiteContext } from './useCreateSiteContext'
import { WizardFrame } from './WizardFrame'

interface CreateSiteWizardProps {
  connectionId: string
  sessionId: string
  serverName: string
  initialRun: RunRecord | null
  onClose: () => void
}

type SetupProps = Omit<SetupFlowProps, 'context'>

function ContextProblem({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Callout tone="error">
      <span>{message}</span>
      {onRetry && <div><Button size="sm" onClick={onRetry}>Try again</Button></div>}
    </Callout>
  )
}

function Setup(props: SetupProps) {
  const { context, loading, error, reload } = useCreateSiteContext(props.connectionId, props.sessionId)
  if (context && hasServer(context)) return <SetupFlow {...props} context={context} />
  const frame = (body: ReactNode) => <WizardFrame subtitle={`Checking ${props.serverName}`} onBack={props.onCancel}>{body}</WizardFrame>
  if (loading) return frame(<div className="flex justify-center py-16 text-nd-text-muted"><Loader2 size={20} className="animate-spin" /></div>)
  if (error !== null) return frame(<ContextProblem message={error} onRetry={() => void reload()} />)
  return frame(<ContextProblem message={`Shellway found no nginx or Apache on ${props.serverName}. Create site needs one of them to serve the site.`} />)
}

export function CreateSiteWizard({ connectionId, sessionId, serverName, initialRun, onClose }: CreateSiteWizardProps) {
  const run = useCreateRun(connectionId, sessionId, initialRun)
  const [plan, setPlan] = useState<PlanAction[] | null>(null)
  const { record } = run

  const start = (input: CreateSiteInput, planned: PlanAction[]) => {
    setPlan(planned)
    void run.start(input)
  }

  if (record) return <RunScreen run={{ ...run, record }} plan={plan} onClose={onClose} />
  return (
    <Setup
      connectionId={connectionId}
      sessionId={sessionId}
      serverName={serverName}
      starting={run.busy}
      startError={run.error}
      onCancel={onClose}
      onStart={start}
    />
  )
}
