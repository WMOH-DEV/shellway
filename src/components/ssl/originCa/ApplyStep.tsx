import { AlertTriangle, Check } from 'lucide-react'
import { applyOutcome, switchFailureView, undoOutcome } from '@/utils/ssl/switchWizard/switchView'
import { OutputPanel } from '../detail/OutputPanel'
import { StepHeading } from '../https/StepHeading'
import { NameRows } from '../https/VerifyStep'
import type { SwitchFlow } from './useSwitchFlow'

function Failure({ title, note }: { title: string; note: string }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-[10px] border border-nd-error/30 bg-nd-error/[0.07] px-3.5 py-3 text-[13px] text-nd-text-secondary">
      <AlertTriangle size={15} className="mt-px shrink-0 text-nd-error-fg" aria-hidden />
      <div className="flex flex-col gap-1">
        <span className="font-medium text-nd-error-fg">{title}</span>
        <span>{note}</span>
      </div>
    </div>
  )
}

function Notice({ children }: { children: string }) {
  return (
    <div role="status" className="flex items-center gap-2.5 rounded-[10px] border border-nd-success/30 bg-nd-success/[0.07] px-3.5 py-3 text-[13px] text-nd-text-secondary">
      <Check size={15} className="text-nd-success-fg" aria-hidden /> {children}
    </div>
  )
}

function subtitle(flow: SwitchFlow): string {
  const { undo } = flow
  if (undo.run.running) return `Putting the old site file back, testing ${flow.driver.label}, reloading it and checking the result.`
  if (undo.result?.ok) return 'The switch was undone. certbot\'s certificate is in use again.'
  if (undo.result || undo.error !== null) return 'Undoing the switch did not finish. Check the output below.'
  if (flow.applyRun.running) return `Backing up the site file, replacing the certificate lines, reloading ${flow.driver.label} and checking the result.`
  if (flow.applyResult?.ok) return `${flow.driver.label} now presents the Cloudflare Origin CA certificate.`
  return 'Shellway runs the script once and checks what visitors get.'
}

export function ApplyStep({ flow }: { flow: SwitchFlow }) {
  const { applyRun, applyResult, applyError, undo } = flow
  const undone = undo.result?.ok === true
  const hasUndo = undo.run.running || undo.result !== null || undo.error !== null
  const switchStands = applyResult?.ok === true && !hasUndo
  return (
    <div className="flex flex-col gap-4">
      <StepHeading title="Apply and verify" subtitle={subtitle(flow)} />
      {switchStands && <Notice>The switch is done. Every name now presents the Cloudflare Origin CA certificate.</Notice>}
      {!applyResult && applyError !== null && !applyRun.running && <Failure title="The connection dropped while applying." note="Check the site before trying again." />}
      {applyResult && !applyResult.ok && <Failure {...switchFailureView(applyResult)} />}
      {switchStands && <NameRows names={applyResult.verify} />}
      {(applyRun.running || applyRun.output || applyResult || applyError) && (
        <OutputPanel
          command="sudo -n sh -s"
          output={applyRun.output || applyResult?.output || ''}
          running={applyRun.running}
          outcome={applyRun.running ? null : applyOutcome(applyResult, applyError)}
        />
      )}
      {undone && <Notice>{`The old site file is back and ${flow.driver.label} is reloaded. certbot's certificate is in use again.`}</Notice>}
      {undo.result && !undo.result.ok && <Failure title="Undoing the switch failed" note="Check the output below." />}
      {hasUndo && (
        <OutputPanel
          command="Undoing the switch"
          output={undo.run.output || undo.result?.output || ''}
          running={undo.run.running}
          outcome={undo.run.running ? null : undoOutcome(undo.result, undo.error)}
        />
      )}
    </div>
  )
}
