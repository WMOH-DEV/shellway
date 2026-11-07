import type { PlanStepView } from '@/types/server/core'
import { Chip, CodeBox } from '../kit'
import { DiffView } from './DiffView'

export function PlanStepCard({ step, index }: { step: PlanStepView; index: number }) {
  return (
    <section aria-label={step.label} className="flex flex-col gap-2.5 rounded-[10px] border border-nd-border bg-nd-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-4 text-right font-mono text-[11px] text-nd-text-muted">{index + 1}</span>
        <span className="text-[13px] font-semibold text-nd-text-primary">{step.label}</span>
        <div className="flex-1" />
        {step.root && <Chip tone="warning" dense>runs as root</Chip>}
        {step.reversible && <Chip tone="success" dense>can be undone</Chip>}
        {step.detached && <Chip tone="info" dense>keeps running if you disconnect</Chip>}
      </div>
      <CodeBox text={step.display} label={`${step.label} command`} />
      {step.diff && <DiffView diff={step.diff} label={`Changes for ${step.label}`} />}
    </section>
  )
}
