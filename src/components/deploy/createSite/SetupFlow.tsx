import { useState } from 'react'
import { ArrowRight, Rocket } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { CloudflareZoneRef, CreateSiteInput, CreateSiteSecrets, PlanAction } from '@/types/createSite'
import { buildPlan, planMeta } from '@/utils/createSite/plan'
import {
  WIZARD_STEPS,
  commandsStepProblem,
  dnsInput,
  domainStepProblem,
  driverFor,
  siteStepProblem,
  stackStepProblem,
  toInput,
  toSecrets,
  type ServerContext,
  type WizardStep
} from '@/utils/createSite/wizard'
import { pluralize } from '@/utils/ssl/time'
import type { WebServerDriver } from '@/utils/webServer'
import { CommandsStep } from './CommandsStep'
import { CreateSiteStepper } from './CreateSiteStepper'
import { DomainStep } from './DomainStep'
import { ReviewStep } from './ReviewStep'
import { IfStepFailsCard, SetsUpCard } from './SideCards'
import { SiteStep } from './SiteStep'
import { StackStep } from './StackStep'
import { stepDetails } from './stepDetails'
import { useCreateSiteDraft, type CreateSiteDraftModel, type CreateSitePrefill } from './useCreateSiteDraft'
import { WizardFrame } from './WizardFrame'

export interface SetupFlowProps {
  connectionId: string
  sessionId: string
  serverName: string
  context: ServerContext
  starting: boolean
  startError: string | null
  rechecking: boolean
  prefill?: CreateSitePrefill
  onCancel: () => void
  onStart: (input: CreateSiteInput, secrets: CreateSiteSecrets, plan: PlanAction[]) => void
  onRecheck: () => void
}

type FormStep = Exclude<WizardStep, 'review'>

const isFormStep = (step: WizardStep): step is FormStep => step !== 'review'

const NEXT_HINTS: Record<FormStep, string> = {
  site: 'Next: the stack',
  stack: 'Next: commands and environment',
  commands: 'Next: DNS and HTTPS',
  domain: 'Next: review the plan'
}

function checkedZone({ nameCheck, draft }: CreateSiteDraftModel): CloudflareZoneRef | null {
  return nameCheck?.domain === draft.domain ? nameCheck.result?.zone ?? null : null
}

function reviewPlan(input: () => CreateSiteInput, context: ServerContext, driver: WebServerDriver): PlanAction[] | string {
  try {
    return buildPlan(input(), context.tools, driver)
  } catch (err) {
    return (err as Error).message
  }
}

function stepProblem(step: FormStep, model: CreateSiteDraftModel, context: ServerContext): string | null {
  switch (step) {
    case 'site': return siteStepProblem(model.draft, model.nameCheck, context, model.projectCheck)
    case 'stack': return stackStepProblem(model.draft, context)
    case 'commands': return commandsStepProblem(model.draft, context.tools, context.server)
    case 'domain': return domainStepProblem(model.draft)
  }
}

function PlanFooterNote({ plan, fullSudo }: { plan: PlanAction[]; fullSudo: boolean }) {
  const { minutes, needsFullSudo } = planMeta(plan)
  const sudo = needsFullSudo ? ` · needs full sudo · ${fullSudo ? 'available' : 'not available'}` : ''
  return <span className="text-xs text-nd-text-muted">About {pluralize(minutes, 'minute')}{sudo}</span>
}

function NextActions({ step, problem, onNext }: { step: FormStep; problem: string | null; onNext: () => void }) {
  return (
    <>
      <span className="max-w-[50%] truncate text-xs text-nd-text-muted" title={problem ?? undefined}>{problem ?? NEXT_HINTS[step]}</span>
      <Button variant="primary" onClick={onNext} disabled={problem !== null}>Continue <ArrowRight size={13} /></Button>
    </>
  )
}

interface CreateActionsProps {
  plan: PlanAction[] | string
  fullSudo: boolean
  starting: boolean
  rechecking: boolean
  onCreate: (plan: PlanAction[]) => void
  onRecheck: () => void
}

function BlockedNote({ rechecking, onRecheck }: Pick<CreateActionsProps, 'rechecking' | 'onRecheck'>) {
  return (
    <>
      <span className="text-xs text-nd-error-fg">A step is blocked. Fix it on the server, then check again.</span>
      <Button onClick={onRecheck} disabled={rechecking}>{rechecking ? 'Checking…' : 'Check again'}</Button>
    </>
  )
}

function CreateActions({ plan, fullSudo, starting, rechecking, onCreate, onRecheck }: CreateActionsProps) {
  const ready = Array.isArray(plan)
  const blocked = ready && plan.some((action) => action.chip === 'blocked')
  return (
    <>
      {blocked && <BlockedNote rechecking={rechecking} onRecheck={onRecheck} />}
      {ready && !blocked && <PlanFooterNote plan={plan} fullSudo={fullSudo} />}
      <Button variant="primary" onClick={() => ready && onCreate(plan)} disabled={!ready || blocked || starting}>
        <Rocket size={13} /> {starting ? 'Starting…' : 'Create site'}
      </Button>
    </>
  )
}

export function SetupFlow({ connectionId, sessionId, serverName, context, starting, startError, rechecking, prefill, onCancel, onStart, onRecheck }: SetupFlowProps) {
  const model = useCreateSiteDraft(connectionId, sessionId, context.tools, prefill)
  const [step, setStep] = useState<WizardStep>('site')
  const driver = driverFor(context.server)
  const zone = checkedZone(model)
  const dns = dnsInput(model.draft, context, zone)
  const input = () => toInput(model.draft, context, zone)
  const plan = step === 'review' ? reviewPlan(input, context, driver) : null
  const stepIndex = WIZARD_STEPS.indexOf(step)
  const details = stepDetails(step, { draft: model.draft, server: context.server, dns, planSteps: Array.isArray(plan) ? plan.length : null })

  const startWith = (ready: PlanAction[]) => {
    const built = input()
    onStart(built, toSecrets(model.draft, built), ready)
  }

  const back = () => (stepIndex === 0 ? onCancel() : setStep(WIZARD_STEPS[stepIndex - 1]))
  const next = () => {
    if (step === 'stack') model.confirmStack()
    setStep(WIZARD_STEPS[stepIndex + 1])
  }

  const footer = (
    <>
      <Button onClick={back} disabled={starting}>{stepIndex === 0 ? 'Cancel' : 'Back'}</Button>
      <div className="flex-1" />
      {startError && <span role="alert" className="max-w-[40%] truncate text-xs text-nd-error-fg" title={startError}>{startError}</span>}
      {isFormStep(step) && <NextActions step={step} problem={stepProblem(step, model, context)} onNext={next} />}
      {plan !== null && <CreateActions plan={plan} fullSudo={context.fullSudo} starting={starting} rechecking={rechecking} onCreate={(ready) => startWith(ready)} onRecheck={onRecheck} />}
    </>
  )

  const aside = (
    <>
      <CreateSiteStepper current={step} details={details} onSelect={setStep} />
      {step === 'review' ? <IfStepFailsCard /> : <SetsUpCard serverLabel={driver.label} codeSource={model.draft.codeSource} dnsByHand={dns === null || dns.zoneId === null} />}
    </>
  )

  return (
    <WizardFrame subtitle={model.draft.domain || `folder, ${driver.label}, DNS, HTTPS and deploys, in one go`} onBack={onCancel} aside={aside} footer={footer}>
      {step === 'site' && <SiteStep model={model} tools={context.tools} />}
      {step === 'stack' && <StackStep model={model} tools={context.tools} serverLabel={driver.label} serverName={serverName} />}
      {step === 'commands' && <CommandsStep model={model} connectionId={connectionId} server={context.server} tools={context.tools} />}
      {step === 'domain' && <DomainStep model={model} zone={zone} dns={dns} />}
      {plan !== null && <ReviewStep plan={plan} fullSudo={context.fullSudo} onEdit={setStep} />}
    </WizardFrame>
  )
}
