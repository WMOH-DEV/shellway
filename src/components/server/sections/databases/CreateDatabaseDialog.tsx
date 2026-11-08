import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { SearchSelect } from '@/components/ui/SearchSelect'
import type { CreateDatabaseParams } from '@/utils/server/databases/actions/create'
import { DIALECT } from '@/utils/server/databases/dialect'
import { DB_HOST, DB_NAME, DB_USER, MASK } from '@/utils/server/databases/identifiers'
import { findUser, hasDatabase } from '@/utils/server/databases/plan'
import type { EngineFacts, SiteEnv } from '@/utils/server/databases/types'
import { DialogFooter, Field, fieldError, SecretField, TextInput, WillRun } from './DialogParts'

interface Props {
  data: EngineFacts
  sites: SiteEnv[]
  password: string
  onClose(): void
  onSubmit(params: CreateDatabaseParams): void
}

const siteSlug = (site: string): string => site.replace(/-/g, '_').slice(0, 26)

function statements(data: EngineFacts, name: string, user: string, host: string, isNewUser: boolean): string[] {
  const dialect = DIALECT[data.engine]
  const createUser = isNewUser ? [dialect.createUser(user, host, MASK)] : []
  if (data.engine === 'postgresql') return [...createUser, dialect.createDatabase(name, user)]
  return [dialect.createDatabase(name), ...createUser, dialect.grantAll(name, user, host)]
}

export function CreateDatabaseDialog({ data, sites, password, onClose, onSubmit }: Props) {
  const [site, setSite] = useState('')
  const [name, setName] = useState('')
  const [user, setUser] = useState('')
  const [host, setHost] = useState('localhost')
  const isMysql = data.engine === 'mysql'
  const isNewUser = !findUser(data, user, host)
  const readableSites = sites.filter((candidate) => candidate.readable)

  const nameError = hasDatabase(data, name) ? `${name} already exists.` : fieldError(name, DB_NAME, 'Letters, numbers and _ only, up to 64.')
  const userError = fieldError(user, DB_USER, 'Letters, numbers and _ only, up to 32.')
  const hostError = fieldError(host, DB_HOST, 'Use localhost, an IP address, or % for any host.')
  const isValid = DB_NAME.test(name) && DB_USER.test(user) && DB_HOST.test(host) && !nameError
  const preview = useMemo(() => (isValid ? statements(data, name, user, host, isNewUser) : []), [data, name, user, host, isNewUser, isValid])

  const pickSite = (value: string) => {
    setSite(value)
    if (!value) return
    setName(`${siteSlug(value)}_prod`)
    setUser(siteSlug(value))
  }

  const submit = () => onSubmit({ engine: data.engine, name, user, host, password: isNewUser ? password : undefined, site: site || undefined })

  return (
    <Modal open onClose={onClose} title="Create database" maxWidth="max-w-xl">
      <div className="flex flex-col gap-4">
        {readableSites.length > 0 && (
          <Field label="For site" hint="Fills the names and writes the connection into this site's env file.">
            <SearchSelect value={site} onChange={pickSite} options={[{ value: '', label: 'No site' }, ...readableSites.map((candidate) => ({ value: candidate.site, label: candidate.site }))]} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Database" error={nameError}>
            <TextInput mono value={name} onChange={setName} placeholder="shop_prod" autoFocus />
          </Field>
          <Field label="User" error={userError} hint={user && !isNewUser ? 'Already exists. It only gets access.' : undefined}>
            <TextInput mono value={user} onChange={setUser} placeholder="shop" />
          </Field>
        </div>
        {isMysql && (
          <Field label="Can sign in from" error={hostError} hint="localhost means only programs on this server.">
            <TextInput mono value={host} onChange={setHost} />
          </Field>
        )}
        {isNewUser && (
          <Field label="Password" hint={`Generated, ${password.length} characters. Shellway does not keep it${site ? '; it goes into the env file only' : ''}.`}>
            <SecretField value={password} />
          </Field>
        )}
        {preview.length > 0 && (
          <WillRun lines={preview} note={site ? `then sets DB_CONNECTION, DB_HOST, DB_PORT, DB_DATABASE, DB_USERNAME${isNewUser ? ', DB_PASSWORD' : ''} in ${site}'s env (backup kept)` : undefined} />
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!isValid} onClick={submit}>Create</Button>
      </DialogFooter>
    </Modal>
  )
}
