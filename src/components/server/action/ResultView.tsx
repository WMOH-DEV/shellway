import { Button } from '@/components/ui/Button'
import type { ActionLaunch } from '@/stores/serverActionStore'
import type { ActionRun } from '@/types/server/core'
import { Notice } from '../kit'
import { DrawerBody, DrawerFooter, Spacer } from './DrawerParts'
import { RunStepList } from './RunStepList'
import { StepOutput } from './StepOutput'
import { failedStep, failureDetail, failureHeadline, rolledBackLabels, stepOutput, successSentence } from './runText'

type FinishedLaunch = ActionLaunch & { run: ActionRun }

interface ResultViewProps {
  launch: FinishedLaunch
  nowMs: number
  onClose(): void
  onReviewAgain(): void
}

function FailureNotices({ run }: { run: ActionRun }) {
  const step = failedStep(run)
  const detail = failureDetail(run)
  const rolledBack = rolledBackLabels(run)
  return (
    <>
      <Notice tone={run.status === 'stopped' ? 'warning' : 'error'} title={failureHeadline(run)}>
        {step && <span className="block">Failed at: {step.label}</span>}
        {detail && <span className="block whitespace-pre-wrap">{detail}</span>}
      </Notice>
      {rolledBack.length > 0 && <Notice tone="info" title="Rolled back">These steps were undone: {rolledBack.join(', ')}.</Notice>}
    </>
  )
}

function FailedOutput({ launch }: { launch: FinishedLaunch }) {
  const step = failedStep(launch.run)
  if (!step) return null
  return <StepOutput label={`Output: ${step.label}`} text={stepOutput(step, launch.output)} live={false} />
}

function LastOutput({ launch }: { launch: FinishedLaunch }) {
  const step = launch.run.steps.at(-1)
  const text = step ? stepOutput(step, launch.output).trim() : ''
  if (!step || !text) return null
  return <StepOutput label={`Output: ${step.label}`} text={text} live={false} />
}

export function ResultView({ launch, nowMs, onClose, onReviewAgain }: ResultViewProps) {
  const { run } = launch
  const succeeded = run.status === 'done'
  return (
    <>
      <DrawerBody>
        {succeeded ? <Notice tone="success" title={successSentence(run)} /> : <FailureNotices run={run} />}
        <RunStepList steps={run.steps} nowMs={nowMs} />
        {succeeded ? <LastOutput launch={launch} /> : <FailedOutput launch={launch} />}
      </DrawerBody>
      <DrawerFooter>
        <Spacer />
        <Button variant={succeeded ? 'primary' : 'secondary'} onClick={onClose}>Close</Button>
        {!succeeded && <Button variant="primary" onClick={onReviewAgain}>Review again</Button>}
      </DrawerFooter>
    </>
  )
}
