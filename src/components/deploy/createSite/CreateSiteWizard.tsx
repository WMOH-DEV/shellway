import { useState, type ReactNode } from 'react'
import { PageSpinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import type { CreateSiteInput, CreateSiteSecrets, PlanAction, RunRecord } from '@/types/createSite'
import { hasServer } from '@/utils/createSite/wizard'
import { Callout } from './Callout'
import { RunScreen } from './RunScreen'
import { SetupFlow, type SetupFlowProps } from './SetupFlow'
import { useCreateRun } from './useCreateRun'
import { useCreateSiteContext } from './useCreateSiteContext'
import type { CreateSitePrefill } from './useCreateSiteDraft'
import { WizardFrame } from './WizardFrame'

interface CreateSiteWizardProps {
  connectionId: string
  sessionId: string
  serverName: string
  initialRun: RunRecord | null
  openDelete?: boolean
  prefill?: CreateSitePrefill
  onClose: () => void
}

type SetupProps = Omit<SetupFlowProps, 'context' | 'rechecking' | 'onRecheck'>

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
  if (context && hasServer(context)) return <SetupFlow {...props} context={context} rechecking={loading} onRecheck={() => void reload()} />
  const frame = (body: ReactNode) => <WizardFrame subtitle={`Checking ${props.serverName}`} onBack={props.onCancel}>{body}</WizardFrame>
  if (loading) return frame(<PageSpinner />)
  if (error !== null) return frame(<ContextProblem message={error} onRetry={() => void reload()} />)
  return frame(<ContextProblem message={`Shellway found no nginx or Apache on ${props.serverName}. Create site needs one of them to serve the site.`} />)
}

export function CreateSiteWizard({ connectionId, sessionId, serverName, initialRun, openDelete, prefill, onClose }: CreateSiteWizardProps) {
  const run = useCreateRun(connectionId, sessionId, initialRun)
  const [plan, setPlan] = useState<PlanAction[] | null>(null)
  const { record } = run

  const start = (input: CreateSiteInput, secrets: CreateSiteSecrets, planned: PlanAction[]) => {
    setPlan(planned)
    void run.start(input, secrets)
  }

  if (record) return <RunScreen run={{ ...run, record }} plan={plan} openDelete={openDelete} onClose={onClose} />
  return (
    <Setup
      connectionId={connectionId}
      sessionId={sessionId}
      serverName={serverName}
      starting={run.busy}
      startError={run.error}
      prefill={prefill}
      onCancel={onClose}
      onStart={start}
    />
  )
}
