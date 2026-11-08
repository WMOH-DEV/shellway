import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Toggle } from '@/components/ui/Toggle'
import { scheduleLabel } from '@/utils/server/databases/actions/backup'
import { BACKUP_DIR } from '@/utils/server/databases/backupScripts'
import type { BackupSchedule } from '@/utils/server/databases/types'
import { DialogFooter, Field, inputClass } from './DialogParts'

export interface ScheduleRequest extends BackupSchedule {
  enabled: boolean
}

const DEFAULT_SCHEDULE: BackupSchedule = { hour: 3, minute: 0, keepDays: 7 }

function parseTime(value: string): Pick<BackupSchedule, 'hour' | 'minute'> | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null
}

export function ScheduleDialog({ current, onClose, onSubmit }: { current: BackupSchedule | null; onClose(): void; onSubmit(request: ScheduleRequest): void }) {
  const initial = current ?? DEFAULT_SCHEDULE
  const [enabled, setEnabled] = useState(true)
  const [time, setTime] = useState(scheduleLabel(initial))
  const [keepDays, setKeepDays] = useState(String(initial.keepDays))
  const parsedTime = parseTime(time)
  const keep = Number(keepDays)
  const isValid = !enabled || (parsedTime !== null && Number.isInteger(keep) && keep >= 1 && keep <= 365)
  const submit = () => onSubmit({ enabled, ...(parsedTime ?? initial), keepDays: Number.isInteger(keep) && keep > 0 ? keep : initial.keepDays })

  return (
    <Modal open onClose={onClose} title="Backup settings">
      <div className="flex flex-col gap-4">
        {current && <Toggle checked={enabled} onChange={setEnabled} label="Back up every night" />}
        {enabled && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Time (server time)">
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={inputClass} />
            </Field>
            <Field label="Keep backups for (days)">
              <input type="number" min={1} max={365} value={keepDays} onChange={(event) => setKeepDays(event.target.value)} className={inputClass} />
            </Field>
          </div>
        )}
        <p className="text-xs text-nd-text-muted">
          {enabled
            ? <>Every MySQL/MariaDB and PostgreSQL database is saved to <span className="font-mono">{BACKUP_DIR}</span>, readable by root only. Older backups are deleted, including ones made by hand, but never after a failed night.</>
            : 'The nightly backup stops. Backup files already saved stay where they are.'}
        </p>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!isValid} onClick={submit}>{enabled ? 'Save schedule' : 'Stop backups'}</Button>
      </DialogFooter>
    </Modal>
  )
}
