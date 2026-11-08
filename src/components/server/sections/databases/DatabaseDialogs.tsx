import { useState } from 'react'
import { Toggle } from '@/components/ui/Toggle'
import { accountLabel } from '@/utils/server/databases/plan'
import { linkedSite, sitesUsingUser } from '@/utils/server/databases/sites'
import type { BackupFacts, BackupFile, DbUser, EngineFacts, SiteEnv } from '@/utils/server/databases/types'
import { AddUserDialog } from './AddUserDialog'
import { CreateDatabaseDialog } from './CreateDatabaseDialog'
import { PasswordDialog } from './PasswordDialog'
import { RestoreDialog } from './RestoreDialog'
import { ScheduleDialog } from './ScheduleDialog'
import { SecretOnceDialog } from './SecretOnceDialog'
import { TypedConfirmDialog } from './TypedConfirmDialog'

export type DialogState =
  | { kind: 'create'; password: string }
  | { kind: 'add-user'; password: string }
  | { kind: 'password'; user: DbUser; password: string }
  | { kind: 'drop-database'; name: string }
  | { kind: 'drop-user'; user: DbUser }
  | { kind: 'restore'; file?: string }
  | { kind: 'schedule' }
  | { kind: 'secret'; title: string; account: string; password: string }

export type RunAction = (type: string, params: unknown, onDone?: () => void) => void

interface Props {
  dialog: DialogState
  data: EngineFacts | null
  sites: SiteEnv[]
  backups: BackupFacts | null
  files: BackupFile[]
  run: RunAction
  show(dialog: DialogState | null): void
}

function DropDatabaseDialog({ data, sites, name, onClose, onConfirm }: { data: EngineFacts; sites: SiteEnv[]; name: string; onClose(): void; onConfirm(backupFirst: boolean): void }) {
  const [backupFirst, setBackupFirst] = useState(true)
  const site = linkedSite(data.engine, name, sites)
  return (
    <TypedConfirmDialog title={`Drop ${name}`} name={name} confirmLabel="Drop database" onClose={onClose} onConfirm={() => onConfirm(backupFirst)}>
      <p>This deletes the database and all its data.{site && ` ${site.site} ${site.byName ? 'looks like it uses' : 'uses'} it and will stop working.`}</p>
      <Toggle checked={backupFirst} onChange={setBackupFirst} label="Save a backup first" />
    </TypedConfirmDialog>
  )
}

function DropUserDialog({ data, sites, user, onClose, onConfirm }: { data: EngineFacts; sites: SiteEnv[]; user: DbUser; onClose(): void; onConfirm(): void }) {
  const users = sitesUsingUser(data.engine, user.name, sites)
  return (
    <TypedConfirmDialog title={`Drop ${accountLabel(data.engine, user.name, user.host ?? 'localhost')}`} name={user.name} confirmLabel="Drop user" onClose={onClose} onConfirm={onConfirm}>
      <p>The user is deleted. Databases are not touched.{users.length > 0 && ` ${users.map((site) => site.site).join(', ')} signs in as ${user.name} and will stop working.`}</p>
    </TypedConfirmDialog>
  )
}

export function DatabaseDialogs({ dialog, data, sites, backups, files, run, show }: Props) {
  const close = () => show(null)
  if (dialog.kind === 'secret') return <SecretOnceDialog title={dialog.title} account={dialog.account} password={dialog.password} onClose={close} />
  if (dialog.kind === 'schedule') {
    return <ScheduleDialog current={backups?.schedule ?? null} onClose={close} onSubmit={(request) => run('databases.schedule-backups', request)} />
  }
  if (!data) return null
  const engine = data.engine
  switch (dialog.kind) {
    case 'create':
      return (
        <CreateDatabaseDialog
          data={data}
          sites={sites}
          password={dialog.password}
          onClose={close}
          onSubmit={(params) => run('databases.create', params, params.password ? () => show({ kind: 'secret', title: `Created ${params.name}`, account: params.user, password: dialog.password }) : undefined)}
        />
      )
    case 'add-user':
      return <AddUserDialog data={data} password={dialog.password} onClose={close} onSubmit={(params) => run('databases.create-user', params, () => show({ kind: 'secret', title: `Added ${params.user}`, account: params.user, password: dialog.password }))} />
    case 'password':
      return (
        <PasswordDialog
          engine={engine}
          user={dialog.user}
          sites={sitesUsingUser(engine, dialog.user.name, sites)}
          password={dialog.password}
          onClose={close}
          onSubmit={(params) => run('databases.change-password', params, () => show({ kind: 'secret', title: 'Password changed', account: params.user, password: dialog.password }))}
        />
      )
    case 'drop-database':
      return <DropDatabaseDialog data={data} sites={sites} name={dialog.name} onClose={close} onConfirm={(backupFirst) => run('databases.drop-database', { engine, name: dialog.name, confirm: dialog.name, backupFirst })} />
    case 'drop-user':
      return <DropUserDialog data={data} sites={sites} user={dialog.user} onClose={close} onConfirm={() => run('databases.drop-user', { engine, user: dialog.user.name, host: dialog.user.host ?? undefined, confirm: dialog.user.name })} />
    case 'restore':
      return <RestoreDialog data={data} files={files} initialFile={dialog.file} onClose={close} onSubmit={(request) => run('databases.restore', request)} />
  }
}
