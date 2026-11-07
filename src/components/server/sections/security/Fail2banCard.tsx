import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { ProbeResult } from '@/types/server/core'
import type { Fail2banFacts, Fail2banJail } from '@/utils/server/security/fail2ban'
import { DEFAULT_JAIL, type JailSettings } from '@/utils/server/security/fail2banActions'
import { assertIp, ipMatches } from '@/utils/server/security/validate'
import { Chip, Label, Notice, ProbeState, SectionCard } from '../../kit'
import { FormModal, errorText } from './FormModal'
import type { SecurityActions } from './types'

const minutes = (seconds: number | null, fallback: number): number => Math.round((seconds ?? fallback) / 60)

function describeJail(jail: Fail2banJail): string {
  return `Bans for ${minutes(jail.bantime, DEFAULT_JAIL.bantime)} min after ${jail.maxretry ?? DEFAULT_JAIL.maxretry} failed logins in ${minutes(jail.findtime, DEFAULT_JAIL.findtime)} min.`
}

function YourIp({ ip, jail, actions }: { ip: string; jail: Fail2banJail; actions: SecurityActions }) {
  if (!ip) return null
  const banned = jail.banned.some((entry) => entry.ip === ip)
  const ignored = jail.ignoreIp.some((entry) => ipMatches(ip, entry))
  const tone = banned ? 'error' : ignored ? 'success' : 'info'
  const text = banned ? 'is banned.' : ignored ? 'is not banned and is on the ignore list.' : 'is not banned, but it is not on the ignore list.'
  const action = banned
    ? <Button size="sm" variant="primary" onClick={() => actions.launch('security.fail2ban.unban', { ip })}>Unban</Button>
    : !ignored ? <Button size="sm" onClick={() => actions.launch('security.fail2ban.ignore', { ip, op: 'add' })}>Never ban me</Button> : undefined
  return <Notice tone={tone} action={action}>Your IP <span className="font-mono">{ip}</span> {text}</Notice>
}

function IgnoreList({ jail, actions }: { jail: Fail2banJail; actions: SecurityActions }) {
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const submit = () => {
    try {
      actions.launch('security.fail2ban.ignore', { ip: assertIp(value), op: 'add' })
      setAdding(false)
      setValue('')
      setError('')
    } catch (caught) {
      setError(errorText(caught))
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Label>Never banned · {jail.ignoreIp.length}</Label>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>Add</Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {jail.ignoreIp.map((entry) => (
          <span key={entry} className="inline-flex items-center gap-1 rounded-md bg-nd-surface-raised px-2 py-0.5 font-mono text-xs text-nd-text-secondary">
            {entry}
            <button type="button" aria-label={`Remove ${entry} from the ignore list`} className="text-nd-text-muted hover:text-nd-text-primary" onClick={() => actions.launch('security.fail2ban.ignore', { ip: entry, op: 'remove' })}>×</button>
          </span>
        ))}
      </div>
      <FormModal open={adding} title="Never ban an address" submitLabel="Review" error={error} onClose={() => setAdding(false)} onSubmit={submit}>
        <Input label="IP address or network" className="font-mono" placeholder="203.0.113.10 or 10.0.0.0/8" value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
      </FormModal>
    </div>
  )
}

function SettingsModal({ jail, open, onClose, actions }: { jail: Fail2banJail; open: boolean; onClose(): void; actions: SecurityActions }) {
  const [form, setForm] = useState({ ban: String(minutes(jail.bantime, DEFAULT_JAIL.bantime)), find: String(minutes(jail.findtime, DEFAULT_JAIL.findtime)), retry: String(jail.maxretry ?? DEFAULT_JAIL.maxretry) })
  const [error, setError] = useState('')
  const submit = () => {
    const settings: JailSettings = { bantime: Number(form.ban) * 60, findtime: Number(form.find) * 60, maxretry: Number(form.retry) }
    if (!Object.values(settings).every((value) => Number.isInteger(value) && value > 0)) return setError('Use whole numbers above zero')
    actions.launch('security.fail2ban.configure', settings)
    onClose()
  }
  return (
    <FormModal open={open} title="fail2ban settings" submitLabel="Review" error={error} onClose={onClose} onSubmit={submit}>
      <div className="grid grid-cols-3 gap-3">
        <Input label="Failed logins" inputMode="numeric" value={form.retry} onChange={(event) => setForm({ ...form, retry: event.target.value })} />
        <Input label="Within (min)" inputMode="numeric" value={form.find} onChange={(event) => setForm({ ...form, find: event.target.value })} />
        <Input label="Ban for (min)" inputMode="numeric" value={form.ban} onChange={(event) => setForm({ ...form, ban: event.target.value })} />
      </div>
    </FormModal>
  )
}

function Fail2banBody({ f2b, actions }: { f2b: Fail2banFacts; actions: SecurityActions }) {
  const [editing, setEditing] = useState(false)
  if (!f2b.installed) {
    return (
      <Notice tone="info" title="Not installed" action={<Button size="sm" variant="primary" onClick={() => actions.launch('security.fail2ban.install', {})}>Install</Button>}>
        fail2ban bans addresses that keep guessing passwords. Your IP is added to the ignore list first.
      </Notice>
    )
  }
  if (!f2b.running) return <Notice tone="warning" title="fail2ban is not running">Start it from Services, or check its log.</Notice>
  if (!f2b.root) return <Notice tone="neutral" title="Details are unavailable">Reading bans needs passwordless sudo (sudo -n).</Notice>
  const jail = f2b.sshd
  if (!jail) {
    return (
      <Notice tone="warning" title="SSH is not protected" action={<Button size="sm" variant="primary" onClick={() => actions.launch('security.fail2ban.configure', DEFAULT_JAIL)}>Protect SSH</Button>}>
        fail2ban runs, but its sshd jail is off.
      </Notice>
    )
  }
  return (
    <>
      <YourIp ip={f2b.clientIp} jail={jail} actions={actions} />
      <div className="flex flex-col gap-1.5">
        <Label>Banned now · {jail.banned.length}</Label>
        {jail.banned.length === 0 && <p className="text-[13px] text-nd-text-muted">Nobody is banned.</p>}
        {jail.banned.map((entry) => (
          <div key={entry.ip} className="flex items-center gap-3 rounded-[10px] border border-nd-border bg-nd-surface px-3 py-1.5">
            <span className="flex-1 font-mono text-[13px] text-nd-text-primary">{entry.ip}</span>
            {entry.minutesLeft !== null && <span className="text-xs text-nd-text-muted">{entry.minutesLeft} min left</span>}
            <Button size="sm" variant="ghost" onClick={() => actions.launch('security.fail2ban.unban', { ip: entry.ip })}>Unban</Button>
          </div>
        ))}
      </div>
      <IgnoreList jail={jail} actions={actions} />
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-nd-text-muted">{describeJail(jail)}</span>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Settings</Button>
      </div>
      {editing && <SettingsModal jail={jail} open onClose={() => setEditing(false)} actions={actions} />}
    </>
  )
}

export function Fail2banCard({ result, actions }: { result: ProbeResult<Fail2banFacts> | undefined; actions: SecurityActions }) {
  const f2b = result?.status === 'ok' ? result.data : null
  const aside = f2b?.installed ? (
    <div className="flex items-center gap-2">
      <Chip dense dot tone={f2b.running ? 'success' : 'warning'}>{f2b.running ? 'running' : 'stopped'}</Chip>
      {f2b.jails.length > 0 && <Chip dense mono>jail: {f2b.jails.join(', ')}</Chip>}
    </div>
  ) : undefined
  return (
    <SectionCard title="fail2ban" aside={aside}>
      <div id="security-fail2ban" className="flex flex-col gap-3">
        <ProbeState result={result} label="fail2ban">
          {(data) => <Fail2banBody f2b={data} actions={actions} />}
        </ProbeState>
      </div>
    </SectionCard>
  )
}
