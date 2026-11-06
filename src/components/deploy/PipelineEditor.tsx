import { useState } from 'react'
import { Activity, ArrowRight, Check, Wrench, Zap } from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import type { SiteSummary } from '@/types/deploy'
import { buildDescription, countChanges, draftIssue } from '@/utils/deploy/pipelineDraft'
import { moveToOtherStage, type StepStage } from '@/utils/deploy/pipelineSteps'
import { CommandStage } from './pipeline/CommandStage'
import { GoLiveStage } from './pipeline/GoLiveStage'
import { HealthStage } from './pipeline/HealthStage'
import { NotifyPanel } from './pipeline/NotifyPanel'
import { PipelineStage } from './pipeline/PipelineStage'
import { RunsAsPanel } from './pipeline/RunsAsPanel'
import { SafetyPanel } from './pipeline/SafetyPanel'
import { SaveBar } from './pipeline/SaveBar'
import { TriggerStage } from './pipeline/TriggerStage'
import { useDoctor } from './pipeline/useDoctor'
import { usePipelineDraft } from './pipeline/usePipelineDraft'
import { deployApi } from './useDeploySites'

interface PipelineEditorProps {
  connectionId: string
  summary: SiteSummary
  onSaved: () => void
  onOpenServerCheck: () => void
}

const STAGE_LABELS: Record<StepStage, string> = {
  buildSteps: 'Build',
  activateSteps: 'After going live'
}

const OTHER_STAGE: Record<StepStage, StepStage> = {
  buildSteps: 'activateSteps',
  activateSteps: 'buildSteps'
}

export function PipelineEditor({ connectionId, summary, onSaved, onOpenServerCheck }: PipelineEditorProps) {
  const { saved, draft, patch, discard, markSaved } = usePipelineDraft(summary.config)
  const doctor = useDoctor(connectionId, summary.config.name, JSON.stringify([saved.buildSteps, saved.activateSteps]))
  const [saving, setSaving] = useState(false)
  const sudoNeeds = doctor.report?.sudoNeeds ?? []

  const moveAcross = (stage: StepStage, index: number) => {
    const { source, target } = moveToOtherStage(draft[stage], draft[OTHER_STAGE[stage]], index)
    patch({ [stage]: source, [OTHER_STAGE[stage]]: target })
  }

  const save = async () => {
    setSaving(true)
    const result = await deployApi().save(connectionId, draft)
    setSaving(false)
    if (!result.success) {
      toast.error('Could not save the pipeline', result.error)
      return
    }
    markSaved(draft)
    toast.success('Pipeline saved', 'Applies from the next deploy')
    onSaved()
  }

  const commandStage = (stage: StepStage) => (
    <CommandStage
      connectionId={connectionId}
      stage={stage}
      label={STAGE_LABELS[stage]}
      steps={draft[stage]}
      sudoNeeds={sudoNeeds}
      otherStageLabel={STAGE_LABELS[OTHER_STAGE[stage]]}
      onChange={(steps) => patch({ [stage]: steps })}
      onMoveToOtherStage={(index) => moveAcross(stage, index)}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-wrap items-start gap-6 px-7 py-5">
          <div className="flex min-w-0 flex-[999_1_560px] flex-col">
            <PipelineStage icon={Zap} title="Trigger" description="When a deploy starts">
              <TriggerStage draft={draft} savedSourceMode={saved.sourceMode} patch={patch} onOpenServerCheck={onOpenServerCheck} />
            </PipelineStage>
            <PipelineStage icon={Wrench} title={STAGE_LABELS.buildSteps} description={buildDescription(draft.layout)}>
              {commandStage('buildSteps')}
            </PipelineStage>
            <PipelineStage
              icon={ArrowRight}
              title="Go live"
              description={draft.layout === 'releases' ? 'Atomic switch to the new release. Rollback takes about a second.' : 'The folder is updated to the new commit.'}
              locked
            >
              <GoLiveStage draft={draft} patch={patch} />
            </PipelineStage>
            <PipelineStage icon={Check} title={STAGE_LABELS.activateSteps} description="Runs on the live site right after the switch.">
              {commandStage('activateSteps')}
            </PipelineStage>
            <PipelineStage icon={Activity} title="Health check" description="Optional. Checked after going live." last>
              <HealthStage draft={draft} patch={patch} />
            </PipelineStage>
          </div>
          <aside className="flex max-w-[360px] flex-1 basis-[300px] flex-col gap-3">
            <SafetyPanel draft={draft} patch={patch} />
            <NotifyPanel notifyUrl={draft.notifyUrl} patch={patch} />
            <RunsAsPanel report={doctor.report} loading={doctor.loading} path={draft.path} onOpenServerCheck={onOpenServerCheck} />
          </aside>
        </div>
      </div>
      <SaveBar changes={countChanges(saved, draft)} issue={draftIssue(draft)} saving={saving} onDiscard={discard} onSave={() => void save()} />
    </div>
  )
}
