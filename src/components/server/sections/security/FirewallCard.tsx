import { useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import type { ProbeResult } from '@/types/server/core'
import { groupUfwRules, type UfwAction, type UfwFacts, type UfwPolicy, type UfwRuleGroup } from '@/utils/server/security/ufw'
import { Chip, Notice, ProbeState, SectionCard, type KitTone } from '../../kit'
import { AddRuleModal } from './AddRuleModal'
import type { SecurityActions } from './types'

const ACTION_TONE: Record<UfwAction, KitTone> = { allow: 'success', limit: 'warning', deny: 'error', reject: 'error' }
const POLICIES = [
  { value: 'deny', label: 'Deny incoming' },
  { value: 'reject', label: 'Reject incoming' },
  { value: 'allow', label: 'Allow incoming' }
]

const readable = (value: string): string => (value === 'Anywhere' ? 'anywhere' : value)

function RuleRow({ group, actions }: { group: UfwRuleGroup; actions: SecurityActions }) {
  const remove = () => actions.guard({ kind: 'ufw.rule.remove', rules: group.rules.map((rule) => ({ number: rule.number, raw: rule.raw })) })
  return (
    <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_80px_minmax(0,1.6fr)_96px] items-center gap-3 rounded-[10px] border border-nd-border bg-nd-surface px-3 py-2 text-[13px] hover:border-nd-border-hover">
      <span className="truncate font-mono text-nd-text-primary">{group.to}</span>
      <span className="truncate font-mono text-nd-text-secondary">{readable(group.from)}</span>
      <span><Chip dense tone={ACTION_TONE[group.action]}>{group.action}</Chip></span>
      <span className="truncate text-nd-text-muted">{group.protectedSsh ? 'SSH · protected' : group.comment || (group.direction === 'in' ? '' : `${group.direction}going`)}</span>
      <span className="flex justify-end">
        {group.protectedSsh ? (
          <span className="inline-flex items-center gap-1 text-xs text-nd-text-muted"><Lock size={12} aria-hidden />Protected</span>
        ) : (
          <Button size="sm" variant="ghost" disabled={!actions.canGuard} onClick={remove}>Remove</Button>
        )}
      </span>
    </div>
  )
}

function DockerNotice({ ufw }: { ufw: UfwFacts }) {
  if (!ufw.dockerInstalled) return null
  const open = ufw.published.filter((port) => port.publicBinding)
  if (open.length === 0) {
    const local = [...new Set(ufw.published.map((port) => port.container))]
    return (
      <Notice tone="neutral">
        Docker publishes ports around ufw. {local.length > 0 ? `${local.join(', ')} ${local.length === 1 ? 'is' : 'are'} bound to 127.0.0.1, so ${local.length === 1 ? 'it is' : 'they are'} fine. ` : ''}Anything on 0.0.0.0 would be public.
      </Notice>
    )
  }
  return (
    <Notice tone="warning" title="Docker ports skip the firewall">
      These are reachable from the internet even if ufw denies them:{' '}
      <span className="font-mono">{open.map((port) => `${port.container} ${port.binding}`).join(', ')}</span>. Bind them to 127.0.0.1 in the container settings.
    </Notice>
  )
}

function FirewallBody({ ufw, actions }: { ufw: UfwFacts; actions: SecurityActions }) {
  if (!ufw.installed) {
    return (
      <Notice tone="warning" title="No firewall installed" action={<Button size="sm" variant="primary" onClick={() => actions.launch('security.ufw.install', {})}>Install ufw</Button>}>
        ufw is the standard firewall on Ubuntu and Debian.
      </Notice>
    )
  }
  if (!ufw.root) return <Notice tone="neutral" title="Rules are unavailable">Reading firewall rules needs passwordless sudo (sudo -n). ufw is {ufw.active ? 'on' : 'off'}.</Notice>
  const groups = groupUfwRules(ufw.rules, ufw.sshPort)
  return (
    <>
      {!ufw.active && (
        <Notice tone="warning" title="The firewall is off" action={<Button size="sm" variant="primary" disabled={!actions.canGuard} onClick={() => actions.guard({ kind: 'ufw.enable' })}>Turn on</Button>}>
          Shellway allows SSH port {ufw.sshPort ?? 22} first, then turns ufw on.
        </Notice>
      )}
      {groups.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_80px_minmax(0,1.6fr)_96px] gap-3 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-nd-text-dim">
            <span>Port</span><span>From</span><span>Action</span><span>Note</span><span />
          </div>
          {groups.map((group) => <RuleRow key={group.key} group={group} actions={actions} />)}
        </div>
      )}
      {ufw.active && groups.length === 0 && <p className="text-[13px] text-nd-text-muted">No rules yet.</p>}
      <DockerNotice ufw={ufw} />
    </>
  )
}

function Header({ ufw, actions, onAdd }: { ufw: UfwFacts | null; actions: SecurityActions; onAdd(): void }) {
  if (!ufw?.installed) return null
  const incoming = ufw.defaults?.incoming
  const setPolicy = (policy: string) => actions.guard({ kind: 'ufw.default', direction: 'incoming', policy: policy as UfwPolicy })
  return (
    <div className="flex items-center gap-2">
      <Chip dense dot tone={ufw.active ? 'success' : 'warning'}>{ufw.active ? 'ufw active' : 'ufw off'}</Chip>
      {ufw.root && incoming && POLICIES.some((policy) => policy.value === incoming) && (
        <Select aria-label="Default policy for incoming traffic" className="h-7 text-xs" options={POLICIES} value={incoming} disabled={!actions.canGuard} onChange={(event) => setPolicy(event.target.value)} />
      )}
      {ufw.root && <Button size="sm" disabled={!actions.canGuard} onClick={onAdd}>Add rule</Button>}
    </div>
  )
}

export function FirewallCard({ result, actions }: { result: ProbeResult<UfwFacts> | undefined; actions: SecurityActions }) {
  const [adding, setAdding] = useState(false)
  const ufw = result?.status === 'ok' ? result.data : null
  return (
    <SectionCard title="Firewall" aside={<Header ufw={ufw} actions={actions} onAdd={() => setAdding(true)} />}>
      <div id="security-firewall" className="flex flex-col gap-3">
        <ProbeState result={result} label="the firewall">
          {(data) => <FirewallBody ufw={data} actions={actions} />}
        </ProbeState>
      </div>
      <AddRuleModal open={adding} onClose={() => setAdding(false)} onSubmit={(request) => { setAdding(false); actions.guard(request) }} />
    </SectionCard>
  )
}
