import type { ReactNode } from 'react'
import { ArrowRight, Download, Lock, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { verifyProblems } from '@/utils/ssl/addHttps/verifyView'
import type { AddHttpsFlow } from './useAddHttpsFlow'

interface WizardFooterProps {
  flow: AddHttpsFlow
  onCancel: () => void
  onFinished: () => void
  onBackToDeploy: () => void
}

const Hint = ({ children }: { children: ReactNode }) => <span className="text-xs text-nd-text-muted">{children}</span>

function Continue({ flow }: { flow: AddHttpsFlow }) {
  return (
    <Button variant="primary" onClick={flow.next} disabled={!flow.canContinue}>
      Continue <ArrowRight size={13} />
    </Button>
  )
}

function SiteActions({ flow }: { flow: AddHttpsFlow }) {
  const count = flow.site.selected.length
  return (
    <>
      <Hint>{count} {count === 1 ? 'name' : 'names'} ready</Hint>
      <Continue flow={flow} />
    </>
  )
}

function PrepareActions({ flow }: { flow: AddHttpsFlow }) {
  const { prepare } = flow
  const { facts, plan, run } = prepare
  if (!facts || !plan) return null
  const checkAgain = (
    <Button onClick={() => void prepare.prep.reload()} disabled={prepare.prep.loading || run.running}>
      <RefreshCw size={13} className={prepare.prep.loading ? 'animate-spin' : undefined} /> Check again
    </Button>
  )
  if (prepare.ready) return <Continue flow={flow} />
  if (plan.blockedReason) return checkAgain
  if (prepare.manual || !facts.fullSudo) {
    return (
      <>
        {facts.fullSudo && <Button onClick={() => prepare.setManual(false)}>Let Shellway install it</Button>}
        {checkAgain}
      </>
    )
  }
  return (
    <>
      <Hint>About a minute</Hint>
      <Button onClick={() => prepare.setManual(true)} disabled={run.running}>I'll install it myself</Button>
      <Button variant="primary" onClick={() => void prepare.install()} disabled={run.running || prepare.prep.loading}>
        <Download size={13} /> {run.running ? 'Installing…' : 'Install certbot'}
      </Button>
    </>
  )
}

function IssueActions({ flow }: { flow: AddHttpsFlow }) {
  const { issue } = flow
  return (
    <>
      <Hint>Runs once per click</Hint>
      <Button variant="primary" onClick={() => void issue.submit()} disabled={!issue.rows || issue.run.running}>
        <Lock size={13} /> {issue.run.running ? 'Working…' : issue.staging ? 'Test and issue certificate' : 'Issue certificate'}
      </Button>
    </>
  )
}

interface VerifyActionsProps {
  flow: AddHttpsFlow
  onFinished: () => void
  onBackToDeploy: () => void
}

function VerifyActions({ flow, onFinished, onBackToDeploy }: VerifyActionsProps) {
  const { verify } = flow
  const passed = verify.result !== null && verifyProblems(verify.result).length === 0
  return (
    <>
      <Button onClick={() => void verify.run()} disabled={verify.loading}>
        <RefreshCw size={13} className={verify.loading ? 'animate-spin' : undefined} /> Verify again
      </Button>
      {flow.site.isDeploySite && <Button onClick={onBackToDeploy}>Back to Deploy site</Button>}
      <Button variant={passed ? 'primary' : 'secondary'} onClick={onFinished}>Back to hostnames</Button>
    </>
  )
}

function StepActions({ flow, onFinished, onBackToDeploy }: VerifyActionsProps) {
  if (flow.step === 'site') return <SiteActions flow={flow} />
  if (flow.step === 'prepare') return <PrepareActions flow={flow} />
  if (flow.step === 'issue') return <IssueActions flow={flow} />
  return <VerifyActions flow={flow} onFinished={onFinished} onBackToDeploy={onBackToDeploy} />
}

export function WizardFooter({ flow, onCancel, onFinished, onBackToDeploy }: WizardFooterProps) {
  const busy = flow.prepare.run.running || flow.issue.run.running
  return (
    <footer className="flex flex-wrap items-center gap-2.5 border-t border-nd-border bg-nd-bg-secondary px-7 py-3">
      {flow.step === 'verify'
        ? null
        : <Button onClick={flow.step === 'site' ? onCancel : flow.back} disabled={busy}>{flow.step === 'site' ? 'Cancel' : 'Back'}</Button>}
      <div className="flex-1" />
      <StepActions flow={flow} onFinished={onFinished} onBackToDeploy={onBackToDeploy} />
    </footer>
  )
}
