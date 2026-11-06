import { AlertTriangle, Check, Circle, Loader2 } from 'lucide-react'
import { prepareStage } from '@/utils/ssl/switchWizard/steps'
import { OutputPanel } from '../detail/OutputPanel'
import { StepHeading } from '../https/StepHeading'
import type { SwitchFlow } from './useSwitchFlow'

type RowState = 'done' | 'working' | 'waiting' | 'failed'

const ROW_ICON = {
  done: <Check size={14} className="text-nd-success" aria-hidden />,
  working: <Loader2 size={14} className="animate-spin text-nd-info" aria-hidden />,
  waiting: <Circle size={14} className="text-nd-text-muted" aria-hidden />,
  failed: <AlertTriangle size={14} className="text-nd-error" aria-hidden />
} as const

function Row({ state, label }: { state: RowState; label: string }) {
  return (
    <li className="flex items-center gap-2.5 text-[13px] text-nd-text-primary">
      {ROW_ICON[state]} {label}
    </li>
  )
}

function rowStates(output: string, running: boolean, failed: boolean): [RowState, RowState] {
  const onSigning = prepareStage(output) === 'sign'
  if (failed) return onSigning ? ['done', 'failed'] : ['failed', 'waiting']
  if (!running) return ['waiting', 'waiting']
  return onSigning ? ['done', 'working'] : ['working', 'waiting']
}

export function PrepareStep({ flow }: { flow: SwitchFlow }) {
  const { prepareRun, prepareError } = flow
  const [key, sign] = rowStates(prepareRun.output, prepareRun.running, prepareError !== null)
  return (
    <div className="flex flex-col gap-4">
      <StepHeading title="Create the certificate" subtitle="The private key is made on the server and never leaves it. Only a signing request goes to Cloudflare." />
      <ol aria-label="Progress" className="flex flex-col gap-2.5 rounded-[10px] border border-nd-border bg-nd-bg-secondary p-4">
        <Row state={key} label="Make the key and signing request on the server" />
        <Row state={sign} label="Cloudflare signs the certificate" />
      </ol>
      {prepareError && (
        <div role="alert" className="flex items-start gap-2.5 rounded-[10px] border border-nd-error/30 bg-nd-error/10 px-3.5 py-3 text-[13px] text-nd-text-secondary">
          <AlertTriangle size={15} className="mt-px shrink-0 text-nd-error" aria-hidden />
          <div className="flex flex-col gap-1">
            <span className="font-medium text-nd-error">The certificate could not be created</span>
            <span>{prepareError}</span>
            <span className="text-nd-text-primary">Nothing in nginx was changed.</span>
          </div>
        </div>
      )}
      {(prepareRun.running || prepareRun.output) && (
        <OutputPanel command="Creating the certificate" output={prepareRun.output} running={prepareRun.running} outcome={null} />
      )}
    </div>
  )
}
