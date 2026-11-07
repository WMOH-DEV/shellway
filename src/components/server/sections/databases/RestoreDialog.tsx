import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { formatFileSize } from '@/utils/fileSize'
import type { RestoreMode } from '@/utils/server/databases/actions/restore'
import { userDatabases } from '@/utils/server/databases/facts'
import { DB_NAME } from '@/utils/server/databases/identifiers'
import { hasDatabase } from '@/utils/server/databases/plan'
import type { BackupFile, EngineFacts } from '@/utils/server/databases/types'
import { Notice, Segmented } from '@/components/server/kit'
import { DialogFooter, Field, fieldError, TextInput } from './DialogParts'

export interface RestoreRequest {
  file: string
  target: string
  mode: RestoreMode
  confirm?: string
}

interface Props {
  data: EngineFacts
  files: BackupFile[]
  initialFile?: string
  onClose(): void
  onSubmit(request: RestoreRequest): void
}

export const backupLabel = (file: BackupFile): string => `${file.database} · ${new Date(file.modifiedAt).toLocaleString()} · ${formatFileSize(file.sizeBytes)}`

const MODES = [
  { value: 'new' as const, label: 'Into a new database' },
  { value: 'overwrite' as const, label: 'Replace a database' }
]

export function RestoreDialog({ data, files, initialFile, onClose, onSubmit }: Props) {
  const [path, setPath] = useState(initialFile ?? files[0]?.path ?? '')
  const file = files.find((candidate) => candidate.path === path)
  const existing = userDatabases(data)
  const [mode, setMode] = useState<RestoreMode>('new')
  const [newName, setNewName] = useState(file ? `${file.database}_restored`.slice(0, 64) : '')
  const [replaced, setReplaced] = useState(file && existing.includes(file.database) ? file.database : (existing[0] ?? ''))
  const [typed, setTyped] = useState('')

  const pickFile = (value: string) => {
    setPath(value)
    const picked = files.find((candidate) => candidate.path === value)
    if (picked) setNewName(`${picked.database}_restored`.slice(0, 64))
  }

  const nameError = hasDatabase(data, newName) ? `${newName} already exists.` : fieldError(newName, DB_NAME, 'Letters, numbers and _ only, up to 64.')
  const target = mode === 'new' ? newName : replaced
  const isValid = Boolean(file) && (mode === 'new' ? DB_NAME.test(newName) && !nameError : replaced !== '' && typed === replaced)
  const submit = () => onSubmit({ file: path, target, mode, confirm: mode === 'overwrite' ? typed : undefined })

  return (
    <Modal open onClose={onClose} title="Restore a backup" maxWidth="max-w-xl">
      <div className="flex flex-col gap-4">
        <Field label="Backup">
          <Select value={path} onChange={(event) => pickFile(event.target.value)} options={files.map((candidate) => ({ value: candidate.path, label: backupLabel(candidate) }))} />
        </Field>
        <Segmented<RestoreMode> ariaLabel="Restore into" options={MODES} value={mode} onChange={setMode} />
        {mode === 'new' ? (
          <Field label="New database" error={nameError} hint="Your current databases are not touched.">
            <TextInput mono value={newName} onChange={setNewName} />
          </Field>
        ) : (
          <>
            <Field label="Database to replace">
              <Select value={replaced} onChange={(event) => { setReplaced(event.target.value); setTyped('') }} options={existing.map((name) => ({ value: name, label: name }))} />
            </Field>
            <Notice tone="warning" title={`Everything in ${replaced || 'this database'} is replaced`}>Shellway saves a backup of its current data first.</Notice>
            <Field label={`Type ${replaced} to confirm`}>
              <TextInput mono value={typed} onChange={setTyped} aria-label="Confirmation" />
            </Field>
          </>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={mode === 'new' ? 'primary' : 'danger'} disabled={!isValid} onClick={submit}>
          {mode === 'new' ? `Restore into ${target || '…'}` : `Replace ${target}`}
        </Button>
      </DialogFooter>
    </Modal>
  )
}
