import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import type { CreateUserParams } from '@/utils/server/databases/actions/create'
import { DIALECT } from '@/utils/server/databases/dialect'
import { DB_HOST, DB_USER, MASK } from '@/utils/server/databases/identifiers'
import { findUser } from '@/utils/server/databases/plan'
import type { EngineFacts } from '@/utils/server/databases/types'
import { userDatabases } from '@/utils/server/databases/facts'
import { DialogFooter, Field, fieldError, SecretField, TextInput, WillRun } from './DialogParts'

interface Props {
  data: EngineFacts
  password: string
  onClose(): void
  onSubmit(params: CreateUserParams): void
}

export function AddUserDialog({ data, password, onClose, onSubmit }: Props) {
  const [user, setUser] = useState('')
  const [host, setHost] = useState('localhost')
  const [database, setDatabase] = useState('')
  const isMysql = data.engine === 'mysql'
  const dialect = DIALECT[data.engine]
  const userError = findUser(data, user, host) ? 'This user already exists.' : fieldError(user, DB_USER, 'Letters, numbers and _ only, up to 32.')
  const hostError = fieldError(host, DB_HOST, 'Use localhost, an IP address, or % for any host.')
  const isValid = DB_USER.test(user) && DB_HOST.test(host) && !userError
  const preview = isValid ? [dialect.createUser(user, host, MASK), ...(database ? [dialect.grantAll(database, user, host)] : [])] : []
  const submit = () => onSubmit({ engine: data.engine, user, host, password, database: database || undefined })

  return (
    <Modal open onClose={onClose} title="Add user">
      <div className="flex flex-col gap-4">
        <Field label="User" error={userError}>
          <TextInput mono value={user} onChange={setUser} placeholder="reporting" autoFocus />
        </Field>
        {isMysql && (
          <>
            <Field label="Can sign in from" error={hostError} hint="localhost means only programs on this server.">
              <TextInput mono value={host} onChange={setHost} />
            </Field>
            <Field label="Can use">
              <Select value={database} onChange={(event) => setDatabase(event.target.value)} options={[{ value: '', label: 'No database yet' }, ...userDatabases(data).map((name) => ({ value: name, label: name }))]} />
            </Field>
          </>
        )}
        <Field label="Password" hint={`Generated, ${password.length} characters. Shellway does not keep it.`}>
          <SecretField value={password} />
        </Field>
        {preview.length > 0 && <WillRun lines={preview} />}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!isValid} onClick={submit}>Add user</Button>
      </DialogFooter>
    </Modal>
  )
}
