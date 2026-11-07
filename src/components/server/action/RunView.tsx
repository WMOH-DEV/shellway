import { Button } from '@/components/ui/Button'
import type { ActionLaunch } from '@/stores/serverActionStore'
import type { ActionPlanView, RunStepState } from '@/types/server/core'
import { DrawerBody, DrawerFooter, Spacer } from './DrawerParts'
import { RunStepList } from './RunStepList'
import { StepOutput } from './StepOutput'
import { focusStep, stepOutput } from './runText'

const toPendingStep = ({ id, label, display }: ActionPlanView['steps'][number]): RunStepState => ({
  id, label, display, status: 'pending', startedAt: null, finishedAt: null, exitCode: null, output: ''
})

const launchSteps = (launch: ActionLaunch): RunStepState[] => launch.run?.steps ?? launch.plan?.steps.map(toPendingStep) ?? []

interface RunViewProps {
  launch: ActionLaunch
  nowMs: number
  confirmingStop: boolean
  onConfirmStop(confirming: boolean): void
  onStop(): void
  onHide(): void
}

function StopConfirm({ onKeep, onStop }: { onKeep(): void; onStop(): void }) {
  return (
    <>
      <span role="alert" className="text-xs text-nd-text-primary">Stop after the current step? Finished steps stay as they are.</span>
      <Spacer />
      <Button onClick={onKeep}>Keep running</Button>
      <Button variant="danger" onClick={onStop}>Stop</Button>
    </>
  )
}

function RunningActions({ launch, onAskStop, onHide }: { launch: ActionLaunch; onAskStop(): void; onHide(): void }) {
  return (
    <>
      <span className="text-xs text-nd-text-muted">Closing this keeps the action running. Each step runs once.</span>
      <Spacer />
      <Button onClick={onHide}>Hide</Button>
      <Button onClick={onAskStop} disabled={!launch.run || launch.stopping}>{launch.stopping ? 'Stopping after this step…' : 'Stop'}</Button>
    </>
  )
}

export function RunView({ launch, nowMs, confirmingStop, onConfirmStop, onStop, onHide }: RunViewProps) {
  const steps = launchSteps(launch)
  const current = focusStep(steps)
  return (
    <>
      <DrawerBody>
        <RunStepList steps={steps} nowMs={nowMs} />
        {current && <StepOutput label={`Output: ${current.label}`} text={stepOutput(current, launch.output)} live={current.status === 'running'} />}
        {!launch.run && <p className="text-xs text-nd-text-muted">Starting…</p>}
      </DrawerBody>
      <DrawerFooter>
        {confirmingStop
          ? <StopConfirm onKeep={() => onConfirmStop(false)} onStop={onStop} />
          : <RunningActions launch={launch} onAskStop={() => onConfirmStop(true)} onHide={onHide} />}
      </DrawerFooter>
    </>
  )
}
