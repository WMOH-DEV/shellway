import { forwardRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { SearchSelect } from '@/components/ui/SearchSelect'
import { Toggle } from '@/components/ui/Toggle'
import { cn } from '@/utils/cn'
import { describeCron, formatRun, nextRuns, parseCron, presetExpression, presetOf, WEEKDAY_LABELS, type PresetTime, type SchedulePreset } from '@/utils/server/jobs/cron'
import { cronLogPath } from '@/utils/server/jobs/crontab'
import { cronSaveAction, type CronSaveParams } from '@/utils/server/jobs/cronActions'
import { laravelSchedulerCommand, newTaskId, type SitePath } from '@/utils/server/jobs/view'
import { SectionCard, Segmented, TEXT_TONE } from '../../kit'
import { Field, FIELD_INPUT } from './Field'

export interface TaskDraft {
  ref: string | null
  id: string | null
  user: string
  expression: string
  command: string
  logOutput: boolean
}

export const newTaskDraft = (user: string): TaskDraft => ({ ref: null, id: null, user, expression: '30 6 * * *', command: '', logOutput: true })

const PRESETS: { value: SchedulePreset; label: string }[] = [
  { value: 'minute', label: 'Every minute' },
  { value: 'five', label: 'Every 5 min' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom' }
]

interface TaskFormProps {
  draft: TaskDraft
  users: string[]
  sites: SitePath[]
  timeZone: string
  now: Date
  onSave(params: CronSaveParams): void
  onRunNow(user: string, command: string): void
  onCancel(): void
}

function validationError(params: CronSaveParams): string | null {
  try {
    cronSaveAction.validate(params)
    return null
  } catch (error) {
    return (error as Error).message
  }
}

const WEEKDAY_OPTIONS = WEEKDAY_LABELS.map((label, index) => ({ value: String(index), label }))
const MONTH_DAY_OPTIONS = Array.from({ length: 28 }, (_, index) => ({ value: String(index + 1), label: `Day ${index + 1}` }))

function PresetInputs({ preset, time, onChange }: { preset: SchedulePreset; time: PresetTime; onChange(time: PresetTime): void }) {
  if (preset !== 'daily' && preset !== 'weekly' && preset !== 'monthly') return null
  return (
    <div className="flex items-center gap-2">
      {preset === 'weekly' && (
        <SearchSelect aria-label="Day of the week" className={cn(FIELD_INPUT, 'w-36')} value={String(time.weekday)} onChange={(weekday) => onChange({ ...time, weekday: Number(weekday) })} options={WEEKDAY_OPTIONS} />
      )}
      {preset === 'monthly' && (
        <SearchSelect aria-label="Day of the month" className={cn(FIELD_INPUT, 'w-24')} value={String(time.day)} onChange={(day) => onChange({ ...time, day: Number(day) })} options={MONTH_DAY_OPTIONS} />
      )}
      <span className="text-nd-text-muted">at</span>
      <input aria-label="Time" className={cn(FIELD_INPUT, 'w-[90px] font-mono')} value={time.time} onChange={(event) => onChange({ ...time, time: event.target.value })} />
    </div>
  )
}

function Schedule({ expression, timeZone, now }: { expression: string; timeZone: string; now: Date }) {
  const parsed = parseCron(expression)
  if (!parsed.ok) return <span className={cn('text-xs', TEXT_TONE.error)}>{parsed.error}</span>
  const runs = nextRuns(parsed.cron, now, timeZone)
  const next = parsed.cron.reboot ? 'Runs when the server starts.' : `Next: ${runs.map((run) => formatRun(run, now, timeZone)).join(', ')}`
  return (
    <span className="flex flex-col gap-0.5 text-xs text-nd-text-muted">
      <span>{describeCron(expression)} · server time ({timeZone})</span>
      <span>{next}</span>
    </span>
  )
}

export const TaskForm = forwardRef<HTMLInputElement, TaskFormProps>(function TaskForm({ draft, users, sites, timeZone, now, onSave, onRunNow, onCancel }, commandRef) {
  const initial = presetOf(draft.expression)
  const [command, setCommand] = useState(draft.command)
  const [preset, setPreset] = useState<SchedulePreset>(initial.preset)
  const [time, setTime] = useState<PresetTime>(initial.input)
  const [custom, setCustom] = useState(draft.expression)
  const [user, setUser] = useState(draft.user)
  const [logOutput, setLogOutput] = useState(draft.logOutput)
  const [seed] = useState(Math.random)

  const expression = preset === 'custom' ? custom : presetExpression(preset, time) ?? ''
  const id = draft.id ?? newTaskId(command, () => seed)
  const params: CronSaveParams = { user, ref: draft.ref, id, expression, command, logOutput }
  const error = command.trim() === '' ? null : validationError(params)

  const applyScheduler = (workDir: string) => {
    if (!workDir) return
    setCommand(laravelSchedulerCommand(workDir))
    setPreset('minute')
    setLogOutput(false)
  }

  const choosePreset = (next: SchedulePreset) => {
    if (next === 'custom') setCustom(expression || custom)
    setPreset(next)
  }

  const editing = draft.ref !== null
  const ready = command.trim() !== '' && error === null

  return (
    <SectionCard title={editing ? 'Edit scheduled task' : 'New scheduled task'} className="border-nd-border-hover">
      <Field label="Command">
        <input ref={commandRef} className={cn(FIELD_INPUT, 'font-mono text-xs')} value={command} onChange={(event) => setCommand(event.target.value)} placeholder="cd /var/www/app/current && php artisan reports:daily" />
      </Field>
      {sites.length > 0 && (
        <SearchSelect
          aria-label="Use a template"
          className={FIELD_INPUT}
          value=""
          placeholder="Use a template…"
          onChange={applyScheduler}
          options={sites.map((site) => ({ value: site.workDir, label: `Laravel scheduler · ${site.name}` }))}
        />
      )}
      <div className="flex flex-col gap-1.5">
        <Field label="When">
          <Segmented ariaLabel="Schedule" options={PRESETS} value={preset} onChange={choosePreset} />
        </Field>
        <PresetInputs preset={preset} time={time} onChange={setTime} />
        {preset === 'custom' && <input aria-label="Cron expression" className={cn(FIELD_INPUT, 'font-mono')} value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="*/10 * * * *" />}
        <div className="flex items-start gap-2">
          <Schedule expression={expression} timeZone={timeZone} now={now} />
          <span className="ml-auto font-mono text-xs text-nd-text-muted">{expression}</span>
        </div>
      </div>
      <Field label="Run as">
        <SearchSelect className={FIELD_INPUT} value={user} onChange={setUser} options={users.map((name) => ({ value: name, label: name }))} />
      </Field>
      <div className="flex flex-col gap-1">
        <Toggle checked={logOutput} onChange={setLogOutput} label="Keep the output in a log" />
        <span className="font-mono text-xs text-nd-text-muted">{cronLogPath(id)}</span>
      </div>
      {error && <span className={cn('text-xs', TEXT_TONE.error)}>{error}</span>}
      <div className="flex items-center gap-2">
        {editing && <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <div className="flex-1" />
        <Button size="sm" disabled={!ready} onClick={() => onRunNow(user, command.trim())}>Run once now</Button>
        <Button size="sm" variant="primary" disabled={!ready} onClick={() => onSave(params)}>{editing ? 'Save' : 'Add'}</Button>
      </div>
    </SectionCard>
  )
})
