import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { isProtectedUser } from '@/utils/server/databases/identifiers'
import type { DbUser, EngineFacts } from '@/utils/server/databases/types'
import { Chip, Label } from '@/components/server/kit'

interface Props {
  data: EngineFacts
  onAdd(): void
  onPassword(user: DbUser): void
  onDrop(user: DbUser): void
}

const isManaged = (data: EngineFacts, user: DbUser): boolean => !isProtectedUser(data.engine, user.name) && !user.socketLogin

function grantsText(user: DbUser): string {
  const grants = user.grants.length > 0 ? user.grants.join(' · ') : 'no access yet'
  return user.socketLogin ? `${grants} · signs in as the system account` : grants
}

export function UsersTable({ data, onAdd, onPassword, onDrop }: Props) {
  return (
    <section aria-label="Users" className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-nd-border bg-nd-surface">
      <div className="flex items-center gap-2 border-b border-nd-border px-4 py-3">
        <Label>Users</Label>
        <div className="flex-1" />
        <button type="button" onClick={onAdd} className="text-xs text-nd-accent hover:underline">Add user</button>
      </div>
      {data.users.map((user) => (
        <div key={`${user.name}@${user.host ?? ''}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2.5 px-4 py-2.5 hover:bg-nd-surface-hover">
          <span className="flex min-w-0 flex-col gap-px">
            <span className="truncate font-mono text-[12.5px] text-nd-text-primary">{user.name}</span>
            <span className="truncate text-xs text-nd-text-muted" title={grantsText(user)}>{grantsText(user)}</span>
          </span>
          {user.host ? <Chip dense mono tone={user.socketLogin ? 'success' : 'neutral'}>{user.host}</Chip> : <span />}
          {isManaged(data, user) ? (
            <span className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => onPassword(user)}>Password</Button>
              <Button size="sm" variant="ghost" aria-label={`Drop ${user.name}`} title="Drop" onClick={() => onDrop(user)}>
                <Trash2 size={13} />
              </Button>
            </span>
          ) : (
            <span className="text-xs text-nd-text-dim">system</span>
          )}
        </div>
      ))}
    </section>
  )
}
