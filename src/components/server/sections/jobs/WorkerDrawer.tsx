import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Toggle'
import { cn } from '@/utils/cn'
import { workerSaveAction, type WorkerSaveParams } from '@/utils/server/jobs/workerActions'
import { LARAVEL_HORIZON_COMMAND, LARAVEL_QUEUE_COMMAND, type SitePath } from '@/utils/server/jobs/view'
import { Segmented, TEXT_TONE } from '../../kit'
import { Drawer } from './Drawer'
import { Field, FIELD_INPUT } from './Field'

type WorkerPreset = 'queue' | 'horizon' | 'custom'

export interface WorkerDraft {
  editing: boolean
  values: WorkerSaveParams
}

const PRESETS = [
  { value: 'queue' as const, label: 'Laravel queue worker' },
  { value: 'horizon' as const, label: 'Laravel Horizon' },
  { value: 'custom' as const, label: 'Custom' }
]

const PRESET_COMMAND: Record<Exclude<WorkerPreset, 'custom'>, string> = { queue: LARAVEL_QUEUE_COMMAND, horizon: LARAVEL_HORIZON_COMMAND }

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)

function presetOfCommand(command: string): WorkerPreset {
  if (command === LARAVEL_QUEUE_COMMAND) return 'queue'
  return command === LARAVEL_HORIZON_COMMAND ? 'horizon' : 'custom'
}

export function emptyWorker(user: string): WorkerDraft {
  return { editing: false, values: { name: '', command: LARAVEL_QUEUE_COMMAND, directory: '', user, numprocs: 1, autostart: true } }
}

function validationError(values: WorkerSaveParams): string | null {
  try {
    workerSaveAction.validate(values)
    return null
  } catch (error) {
    return (error as Error).message
  }
}

interface WorkerDrawerProps {
  draft: WorkerDraft
  users: string[]
  sites: SitePath[]
  onSave(values: WorkerSaveParams): void
  onClose(): void
}

export function WorkerDrawer({ draft, users, sites, onSave, onClose }: WorkerDrawerProps) {
  const [values, setValues] = useState(draft.values)
  const [preset, setPreset] = useState<WorkerPreset>(presetOfCommand(draft.values.command))
  const error = useMemo(() => validationError(values), [values])
  const set = <K extends keyof WorkerSaveParams>(key: K, value: WorkerSaveParams[K]) => setValues((current) => ({ ...current, [key]: value }))

  const choosePreset = (next: WorkerPreset) => {
    setPreset(next)
    if (next !== 'custom') set('command', PRESET_COMMAND[next])
  }

  const chooseSite = (path: string) => {
    const site = sites.find((candidate) => candidate.workDir === path)
    if (!site) return
    setValues((current) => ({ ...current, directory: site.workDir, name: draft.editing ? current.name : slug(`${site.name.split('.')[0]}-${preset === 'horizon' ? 'horizon' : 'queue'}`) }))
  }

  return (
    <Drawer
      title={draft.editing ? `Edit worker ${draft.values.name}` : 'Add worker'}
      onClose={onClose}
      footer={
        <>
          {error && <span className={cn('mr-auto text-xs', TEXT_TONE.error)}>{error}</span>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={error !== null} onClick={() => onSave(values)}>Review changes</Button>
        </>
      }
    >
      <p className="text-[13px] text-nd-text-muted">Supervisor starts the command, restarts it when it stops and starts it again after a reboot.</p>
      <Segmented ariaLabel="Worker type" options={PRESETS} value={preset} onChange={choosePreset} />
      {sites.length > 0 && (
        <Field label="Site">
          <select className={FIELD_INPUT} value={sites.some((site) => site.workDir === values.directory) ? values.directory : ''} onChange={(event) => chooseSite(event.target.value)}>
            <option value="">Choose a site…</option>
            {sites.map((site) => <option key={site.workDir} value={site.workDir}>{site.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Name" hint={`Saved as /etc/supervisor/conf.d/shellway-${values.name || '<name>'}.conf`}>
        <input className={cn(FIELD_INPUT, 'font-mono')} value={values.name} disabled={draft.editing} onChange={(event) => set('name', event.target.value)} placeholder="shop-queue" />
      </Field>
      <Field label="Command">
        <input className={cn(FIELD_INPUT, 'font-mono text-xs')} value={values.command} onChange={(event) => { setPreset('custom'); set('command', event.target.value) }} />
      </Field>
      <Field label="Folder">
        <input className={cn(FIELD_INPUT, 'font-mono text-xs')} value={values.directory} onChange={(event) => set('directory', event.target.value)} placeholder="/var/www/app/current" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Run as">
          <select className={FIELD_INPUT} value={values.user} onChange={(event) => set('user', event.target.value)}>
            {users.map((user) => <option key={user} value={user}>{user}</option>)}
          </select>
        </Field>
        <Field label="Processes">
          <input type="number" min={1} max={32} className={FIELD_INPUT} value={values.numprocs} onChange={(event) => set('numprocs', Number(event.target.value))} />
        </Field>
      </div>
      <Toggle checked={values.autostart} onChange={(checked) => set('autostart', checked)} label="Start when the server boots" />
    </Drawer>
  )
}
