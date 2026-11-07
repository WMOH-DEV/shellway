import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Toggle } from '@/components/ui/Toggle'
import type { ChangePasswordParams } from '@/utils/server/databases/actions/users'
import { DIALECT } from '@/utils/server/databases/dialect'
import { MASK } from '@/utils/server/databases/identifiers'
import { accountLabel } from '@/utils/server/databases/plan'
import type { DbEngine, DbUser, SiteEnv } from '@/utils/server/databases/types'
import { DialogFooter, Field, SecretField, WillRun } from './DialogParts'

interface Props {
  engine: DbEngine
  user: DbUser
  sites: SiteEnv[]
  password: string
  onClose(): void
  onSubmit(params: ChangePasswordParams): void
}

export function PasswordDialog({ engine, user, sites, password, onClose, onSubmit }: Props) {
  const site = sites.find((candidate) => candidate.readable)
  const [updateSite, setUpdateSite] = useState(site !== undefined)
  const host = user.host ?? 'localhost'
  const label = accountLabel(engine, user.name, host)
  const others = sites.filter((candidate) => !(updateSite && candidate.site === site?.site))
  const submit = () => onSubmit({ engine, user: user.name, host, password, site: updateSite ? site?.site : undefined })

  return (
    <Modal open onClose={onClose} title={`New password for ${label}`}>
      <div className="flex flex-col gap-4">
        <Field label="New password" hint={`Generated, ${password.length} characters. Shellway does not keep it.`}>
          <SecretField value={password} />
        </Field>
        {site && <Toggle checked={updateSite} onChange={setUpdateSite} label={`Also write it into ${site.site}'s env file (backup kept)`} />}
        {others.length > 0 && (
          <p className="text-xs text-nd-warning-fg">{others.map((candidate) => candidate.site).join(', ')} signs in as {user.name}. Update DB_PASSWORD there too, or it stops working.</p>
        )}
        <WillRun lines={[DIALECT[engine].setPassword(user.name, host, MASK)]} />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Change password</Button>
      </DialogFooter>
    </Modal>
  )
}
