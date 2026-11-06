import { useState } from 'react'
import type { SslReport } from '@/types/ssl'
import { nextStep, previousStep, stepDetails, type HttpsStep } from '@/utils/ssl/addHttps/steps'
import { useIssue, type Issue, type Issued } from './useIssue'
import { usePrepare, type Prepare } from './usePrepare'
import { useSiteSelection, type SiteSelection } from './useSiteSelection'
import { useVerify, type Verify } from './useVerify'

interface FlowOptions {
  connectionId: string
  sessionId: string
  report: SslReport
  initialBlockId: string | null
}

export interface AddHttpsFlow {
  step: HttpsStep
  site: SiteSelection
  prepare: Prepare
  issue: Issue
  issued: Issued | null
  verify: Verify
  details: Record<HttpsStep, string>
  prepareSkipped: boolean
  canContinue: boolean
  next: () => void
  back: () => void
  goTo: (step: HttpsStep) => void
}

function canLeave(step: HttpsStep, site: SiteSelection, prepare: Prepare): boolean {
  if (step === 'site') return site.block !== null && !site.readiness.loading && site.readiness.error === null && site.readiness.data !== null && site.selected.length > 0
  if (step === 'prepare') return prepare.ready
  return false
}

export function useAddHttpsFlow({ connectionId, sessionId, report, initialBlockId }: FlowOptions): AddHttpsFlow {
  const [step, setStep] = useState<HttpsStep>('site')
  const [issued, setIssued] = useState<Issued | null>(null)
  const site = useSiteSelection(connectionId, sessionId, report, initialBlockId)
  const prepare = usePrepare(connectionId)
  const issue = useIssue({
    connectionId,
    sessionId,
    blockId: site.block?.id ?? '',
    names: site.selected,
    onIssued: (result) => {
      setIssued(result)
      setStep('verify')
    }
  })
  const verify = useVerify(connectionId, issued)
  const prepareSkipped = prepare.ready

  const details = stepDetails({
    siteTitle: site.title,
    nameCount: site.selected.length,
    certbotVersion: prepare.facts?.certbot?.version ?? null,
    prepareSkipped,
    staging: issue.staging
  })

  return {
    step,
    site,
    prepare,
    issue,
    issued,
    verify,
    details,
    prepareSkipped,
    canContinue: canLeave(step, site, prepare),
    next: () => setStep((current) => nextStep(current, prepareSkipped)),
    back: () => setStep((current) => previousStep(current, prepareSkipped)),
    goTo: setStep
  }
}
