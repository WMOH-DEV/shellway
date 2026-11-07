import { useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { assertPublicKey } from '@/utils/server/security/keyActions'
import type { AuthorizedKey, KeyOwner, KeysFacts } from '@/utils/server/security/keys'
import type { SshFacts } from '@/utils/server/security/ssh'
import type { SecuritySessionInfo } from '@/utils/server/security/guard'
import { Chip, Label, Segmented } from '../../kit'
import { FormModal, errorText } from './FormModal'
import type { SecurityActions } from './types'

const shortFingerprint = (fingerprint: string): string => (fingerprint.length > 20 ? `${fingerprint.slice(0, 11)}…${fingerprint.slice(-3)}` : fingerprint)

function thisPcLabel(session: SecuritySessionInfo | null): string {
  return session?.source === 'agent' ? 'in your SSH agent' : 'this PC'
}

function isThisPc(key: AuthorizedKey, session: SecuritySessionInfo | null): boolean {
  return Boolean(key.fingerprint) && (session?.fingerprints.includes(key.fingerprint) ?? false)
}

function KeyRow({ owner, item, loginUser, isLast, ssh, actions }: { owner: KeyOwner; item: AuthorizedKey; loginUser: string; isLast: boolean; ssh: SshFacts | null; actions: SecurityActions }) {
  const mine = isThisPc(item, actions.session)
  const guarded = mine && owner.user === loginUser
  const lastWithoutPassword = isLast && ssh?.effective?.passwordAuthentication === false
  const remove = () => actions.launch('security.keys.remove', { user: owner.user, fingerprint: item.fingerprint, protectedFingerprints: owner.user === loginUser ? actions.session?.fingerprints ?? [] : [] })
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-nd-border bg-nd-surface px-3 py-2 hover:border-nd-border-hover">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] text-nd-text-primary">{item.comment || item.algorithm}{mine && ` (${thisPcLabel(actions.session)})`}</span>
        <span className="truncate font-mono text-xs text-nd-text-muted">{item.type} {item.bits && item.algorithm === 'RSA' ? `${item.bits} ` : ''}{shortFingerprint(item.fingerprint)}</span>
      </div>
      {mine && <Chip dense tone="success">in use</Chip>}
      {item.weak && <Chip dense tone="warning">{item.weakReason}</Chip>}
      {item.hasOptions && <Chip dense>has options</Chip>}
      {guarded ? (
        <span className="inline-flex items-center gap-1 text-xs text-nd-text-muted"><Lock size={12} aria-hidden />Protected</span>
      ) : (
        <Button size="sm" variant="ghost" disabled={!item.fingerprint || lastWithoutPassword} title={lastWithoutPassword ? 'Last key while password login is off' : undefined} onClick={remove}>Remove</Button>
      )}
    </div>
  )
}

function AddKeyModal({ user, open, onClose, onAdd }: { user: string; open: boolean; onClose(): void; onAdd(key: string): void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const submit = () => {
    try {
      onAdd(assertPublicKey(text))
      setText('')
      setError('')
    } catch (caught) {
      setError(errorText(caught))
    }
  }
  return (
    <FormModal open={open} title={`Add SSH key for ${user}`} submitLabel="Review" error={error} onClose={onClose} onSubmit={submit}>
      <label className="flex flex-col gap-1 text-xs font-medium text-nd-text-secondary">
        Public key (the .pub file)
        <textarea
          className="h-28 resize-none rounded-md border border-nd-border-hover bg-nd-bg-sunken p-2 font-mono text-xs text-nd-text-primary focus:border-nd-accent focus:outline-none"
          placeholder="ssh-ed25519 AAAA… name@laptop"
          value={text}
          onChange={(event) => setText(event.target.value)}
          autoFocus
        />
      </label>
    </FormModal>
  )
}

export function KeysList({ keys, ssh, actions }: { keys: KeysFacts; ssh: SshFacts | null; actions: SecurityActions }) {
  const [selected, setSelected] = useState(keys.loginUser)
  const [adding, setAdding] = useState(false)
  const owner = keys.owners.find((candidate) => candidate.user === selected) ?? keys.owners[0]
  if (!owner) return <p className="text-[13px] text-nd-text-muted">No users with SSH keys were found.</p>
  const options = keys.owners.map((candidate) => ({ value: candidate.user, label: candidate.user, count: candidate.keys.length }))
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 pt-1">
        <Label>Authorized keys · {owner.user}</Label>
        <div className="flex-1" />
        {options.length > 1 && <Segmented ariaLabel="User" options={options} value={owner.user} onChange={setSelected} />}
        <Button size="sm" onClick={() => setAdding(true)}>Add key</Button>
      </div>
      {owner.keys.length === 0 && <p className="text-[13px] text-nd-text-muted">No keys. {owner.user} can only log in with a password.</p>}
      {owner.keys.map((item) => (
        <KeyRow key={`${item.fingerprint}-${item.blob.slice(-12)}`} owner={owner} item={item} loginUser={keys.loginUser} isLast={owner.keys.length === 1} ssh={ssh} actions={actions} />
      ))}
      {actions.session?.source === 'none' && owner.user === keys.loginUser && <p className="text-xs text-nd-text-muted">This session logs in without a key, so no key is marked as this PC's.</p>}
      <AddKeyModal user={owner.user} open={adding} onClose={() => setAdding(false)} onAdd={(key) => { setAdding(false); actions.launch('security.keys.add', { user: owner.user, key }) }} />
    </div>
  )
}
