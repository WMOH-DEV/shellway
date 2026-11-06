import { AlertTriangle, Check } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import type { PrepFacts } from '@/types/ssl'
import { ErrorBanner } from '../LoadState'
import { OutputPanel } from '../detail/OutputPanel'
import { FactsStrip } from './FactsStrip'
import { PlanCard } from './PlanCard'
import { StepHeading } from './StepHeading'
import type { Prepare } from './usePrepare'

function subtitle(facts: PrepFacts, ready: boolean): string {
  if (ready) return `certbot ${facts.certbot?.version ?? ''} is installed and renewal is scheduled.`
  if (facts.certbot === null) return 'certbot is missing. Shellway can install it the recommended way for this server.'
  return 'certbot is installed but is missing its web server plugin or the renewal timer.'
}

function Blocked({ reason, docsUrl }: { reason: string; docsUrl: string }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-[10px] border border-nd-warning/30 bg-nd-warning/10 px-3.5 py-3 text-[13px] text-nd-text-secondary">
      <AlertTriangle size={15} className="mt-px shrink-0 text-nd-warning" aria-hidden />
      <span>
        {reason}{' '}
        <a className="text-nd-accent hover:underline" href={docsUrl} target="_blank" rel="noreferrer">Open certbot's instructions</a>
      </span>
    </div>
  )
}

function ReadyNotice() {
  return (
    <div role="status" className="flex items-center gap-2.5 rounded-[10px] border border-nd-success/35 bg-nd-success/5 px-3.5 py-3 text-[13px] text-nd-text-secondary">
      <Check size={15} className="text-nd-success" aria-hidden /> certbot is ready. Continue to review the commands.
    </div>
  )
}

export function PrepareStep({ prepare }: { prepare: Prepare }) {
  const { prep, facts, plan, ready, manual, run, outcome } = prepare
  if (!facts || !plan) {
    return prep.error
      ? <ErrorBanner message={prep.error} retrying={prep.loading} onRetry={() => void prep.reload()} />
      : <div role="status" aria-label="Checking the server" className="flex justify-center py-16"><Spinner size="md" /></div>
  }
  const byHand = manual || !facts.fullSudo
  return (
    <div className="flex flex-col gap-4">
      <StepHeading title="Prepare the server" subtitle={subtitle(facts, ready)} />
      <FactsStrip facts={facts} />
      {ready && <ReadyNotice />}
      {!ready && plan.blockedReason && <Blocked reason={plan.blockedReason} docsUrl={plan.docsUrl} />}
      {!ready && !plan.blockedReason && (
        <PlanCard plan={plan} manual={byHand} fullSudo={facts.fullSudo} busy={run.running} onRoute={prepare.setRoute} />
      )}
      {(run.running || outcome) && (
        <OutputPanel command="Installing certbot" output={run.output} running={run.running} outcome={outcome} />
      )}
    </div>
  )
}
