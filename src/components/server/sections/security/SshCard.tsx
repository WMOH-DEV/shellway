import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SearchSelect } from '@/components/ui/SearchSelect'
import type { ProbeResult } from '@/types/server/core'
import { validateGuardRequest, type GuardRequest } from '@/utils/server/security/guard'
import type { KeysFacts } from '@/utils/server/security/keys'
import type { RootLogin, SshFacts } from '@/utils/server/security/ssh'
import { Chip, ProbeState, SectionCard, StatusDot, type KitTone } from '../../kit'
import { FormModal, errorText } from './FormModal'
import { KeysList } from './KeysList'
import type { SecurityActions } from './types'

const ROOT_LOGIN_TEXT: Record<RootLogin, string> = {
  'prohibit-password': 'Root login: keys only',
  no: 'Root login: off',
  yes: 'Root login: password or key',
  'forced-commands-only': 'Root login: forced commands only'
}

const ROOT_OPTIONS = [
  { value: 'prohibit-password', label: 'Keys only (recommended)' },
  { value: 'no', label: 'Off' },
  { value: 'yes', label: 'Password or key' }
]

function SettingRow({ tone, title, detail, action }: { tone: KitTone; title: string; detail: ReactNode; action: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-nd-border bg-nd-surface px-3 py-2.5">
      <StatusDot tone={tone} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] text-nd-text-primary">{title}</span>
        <span className="text-xs text-nd-text-muted">{detail}</span>
      </div>
      {action}
    </div>
  )
}

type Editing = { kind: 'root'; value: string } | { kind: 'port'; value: string } | null

function EditModal({ editing, setEditing, onSubmit }: { editing: Editing; setEditing(next: Editing): void; onSubmit(request: GuardRequest): void }) {
  const [error, setError] = useState('')
  const close = () => { setError(''); setEditing(null) }
  const submit = () => {
    if (!editing) return
    try {
      const request = validateGuardRequest(editing.kind === 'root' ? { kind: 'ssh.rootLogin', value: editing.value } : { kind: 'ssh.port', port: editing.value.trim() })
      close()
      onSubmit(request)
    } catch (caught) {
      setError(errorText(caught))
    }
  }
  return (
    <FormModal open={editing !== null} title={editing?.kind === 'root' ? 'Root login' : 'SSH port'} submitLabel="Review" error={error} onClose={close} onSubmit={submit}>
      {editing?.kind === 'root' && <SearchSelect label="Who can log in as root" options={ROOT_OPTIONS} value={editing.value} onChange={(value) => setEditing({ kind: 'root', value })} />}
      {editing?.kind === 'port' && <Input label="New SSH port" className="font-mono" inputMode="numeric" value={editing.value} onChange={(event) => setEditing({ kind: 'port', value: event.target.value })} autoFocus />}
    </FormModal>
  )
}

function passwordDetail(on: boolean, keyAuth: boolean): string {
  if (!on) return 'Only SSH keys can log in.'
  return keyAuth ? 'Turn it off: your key already works. Shellway checks key login in a new connection first.' : 'This session logs in with a password. Connect with a key to turn it off.'
}

function SshSettings({ ssh, actions, onEdit }: { ssh: SshFacts; actions: SecurityActions; onEdit(next: Editing): void }) {
  const effective = ssh.effective
  if (!effective) return <p className="text-[13px] text-nd-text-muted">SSH settings need passwordless sudo (sudo -n) to read.</p>
  const keyAuth = actions.session?.keyAuth ?? false
  const password = effective.passwordAuthentication
  const rootTone: KitTone = effective.permitRootLogin === 'yes' ? (password ? 'error' : 'warning') : 'success'
  return (
    <div className="flex flex-col gap-1.5">
      <SettingRow
        tone={password ? 'warning' : 'success'}
        title={password ? 'Password login is on' : 'Password login is off'}
        detail={passwordDetail(password, keyAuth)}
        action={<Button size="sm" variant={password ? 'primary' : 'secondary'} disabled={!actions.canGuard || (password && !keyAuth)} onClick={() => actions.guard({ kind: 'ssh.password', enabled: !password })}>{password ? 'Turn off' : 'Turn on'}</Button>}
      />
      <SettingRow
        tone={rootTone}
        title={ROOT_LOGIN_TEXT[effective.permitRootLogin]}
        detail={<span className="font-mono">PermitRootLogin {effective.permitRootLogin}</span>}
        action={<Button size="sm" disabled={!actions.canGuard} onClick={() => onEdit({ kind: 'root', value: effective.permitRootLogin === 'forced-commands-only' ? 'prohibit-password' : effective.permitRootLogin })}>Change</Button>}
      />
      <SettingRow
        tone="neutral"
        title={`SSH port ${effective.ports.join(', ')}`}
        detail={ssh.socketActivated ? 'Started by ssh.socket. Shellway restarts the socket after a port change.' : `This session uses port ${ssh.sessionPort ?? '?'}.`}
        action={<Button size="sm" disabled={!actions.canGuard} onClick={() => onEdit({ kind: 'port', value: '' })}>Change</Button>}
      />
    </div>
  )
}

export function SshCard({ ssh, keys, actions }: { ssh: ProbeResult<SshFacts> | undefined; keys: ProbeResult<KeysFacts> | undefined; actions: SecurityActions }) {
  const [editing, setEditing] = useState<Editing>(null)
  const ports = ssh?.status === 'ok' ? ssh.data.effective?.ports : undefined
  return (
    <SectionCard title="SSH access" aside={ports ? <Chip dense mono>port {ports.join(', ')}</Chip> : undefined}>
      <div id="security-ssh" className="flex flex-col gap-3">
        <ProbeState result={ssh} label="SSH settings">
          {(data) => <SshSettings ssh={data} actions={actions} onEdit={setEditing} />}
        </ProbeState>
      </div>
      <div id="security-keys">
        <ProbeState result={keys} label="SSH keys">
          {(data) => <KeysList keys={data} ssh={ssh?.status === 'ok' ? ssh.data : null} actions={actions} />}
        </ProbeState>
      </div>
      <EditModal editing={editing} setEditing={setEditing} onSubmit={actions.guard} />
    </SectionCard>
  )
}
