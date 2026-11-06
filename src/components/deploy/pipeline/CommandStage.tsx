import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import type { DeployStep } from '@/types/deploy'
import type { PresetId } from '@/utils/deploy/presets'
import {
  appendNewSteps,
  blankStep,
  duplicateStep,
  moveStep,
  presetStepsFor,
  presetsWithSteps,
  removeStep,
  stepFlag,
  updateStep,
  type StepStage
} from '@/utils/deploy/pipelineSteps'
import { CommandRow } from './CommandRow'
import { ServiceRestartPicker } from './ServiceRestartPicker'
import { useRowDrag } from './useRowDrag'

interface CommandStageProps {
  connectionId: string
  stage: StepStage
  label: string
  steps: DeployStep[]
  sudoNeeds: string[]
  otherStageLabel: string
  onChange: (steps: DeployStep[]) => void
  onMoveToOtherStage: (index: number) => void
}

export function CommandStage({ connectionId, stage, label, steps, sudoNeeds, otherStageLabel, onChange, onMoveToOtherStage }: CommandStageProps) {
  const drag = useRowDrag((from, to) => onChange(moveStep(steps, from, to)))
  const presetItems = presetsWithSteps(stage).map((preset) => ({ id: preset.id, label: preset.label }))
  const add = (command = '') => onChange([...steps, blankStep(command)])
  const addPreset = (id: string) => onChange(appendNewSteps(steps, presetStepsFor(stage, id as PresetId)))

  return (
    <div className="flex flex-col gap-1.5">
      {steps.length === 0 && <div className="py-1 text-xs italic text-nd-text-muted">No commands</div>}
      {steps.map((step, index) => (
        <CommandRow
          key={index}
          step={step}
          index={index}
          count={steps.length}
          label={label}
          flag={stepFlag(step, sudoNeeds)}
          otherStageLabel={otherStageLabel}
          drag={drag}
          actions={{
            change: (patch) => onChange(updateStep(steps, index, patch)),
            moveUp: () => onChange(moveStep(steps, index, index - 1)),
            moveDown: () => onChange(moveStep(steps, index, index + 1)),
            duplicate: () => onChange(duplicateStep(steps, index)),
            moveToOtherStage: () => onMoveToOtherStage(index),
            remove: () => onChange(removeStep(steps, index))
          }}
        />
      ))}
      <div className="flex flex-wrap items-center gap-x-3 pt-1">
        <Button size="sm" variant="ghost" className="text-nd-info" onClick={() => add()}>
          <Plus size={13} /> Add command
        </Button>
        <ServiceRestartPicker connectionId={connectionId} onPick={(unit) => add(`sudo systemctl restart ${unit}`)} />
        <Dropdown
          items={presetItems}
          onSelect={addPreset}
          trigger={<Button size="sm" variant="ghost">From preset…</Button>}
        />
      </div>
    </div>
  )
}
