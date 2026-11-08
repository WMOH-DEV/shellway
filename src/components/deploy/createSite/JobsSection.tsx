import { Toggle } from '@/components/ui/Toggle'
import type { LaravelJobs, ServerTools } from '@/types/createSite'
import { Section } from '../setup/SiteSections'
import type { CreateSiteDraftModel } from './useCreateSiteDraft'

interface JobsSectionProps {
  model: CreateSiteDraftModel
  tools: ServerTools
}

function JobToggle({ checked, available, label, missing, onChange }: { checked: boolean; available: boolean; label: string; missing: string; onChange: (on: boolean) => void }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Toggle checked={checked && available} disabled={!available} onChange={onChange} label={label} />
      {!available && <span className="pl-11 text-2xs text-nd-text-muted">{missing}</span>}
    </div>
  )
}

export function JobsSection({ model, tools }: JobsSectionProps) {
  const { draft, patch } = model
  if (draft.template !== 'laravel') return null
  const change = (changes: Partial<LaravelJobs>) => patch({ jobs: { ...draft.jobs, ...changes } })
  return (
    <Section title="Scheduler and queue">
      <JobToggle
        checked={draft.jobs.scheduler}
        available={tools.cron}
        label="Run php artisan schedule:run every minute with cron"
        missing="This server has no cron, so the scheduler cannot run."
        onChange={(scheduler) => change({ scheduler })}
      />
      <JobToggle
        checked={draft.jobs.queueWorker}
        available={tools.systemd}
        label="Keep a queue worker running with systemd"
        missing="This server does not run systemd, so Shellway cannot keep a worker running."
        onChange={(queueWorker) => change({ queueWorker })}
      />
    </Section>
  )
}
