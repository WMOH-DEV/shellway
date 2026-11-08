import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { daysSinceCheck, securityUpdates } from '@/utils/server/software/updates'
import type { UpdatesFacts, UpgradePackage } from '@/utils/server/software/types'
import { CALLOUT_TONE, Chip, Notice, ProbeState } from '../../kit'
import type { SoftwareState } from './useSoftware'

const nameList = (names: string[], limit: number): string => (names.length > limit ? `${names.slice(0, limit).join(', ')} and ${names.length - limit} more` : names.join(', '))

function checkedText(facts: UpdatesFacts): string {
  const days = daysSinceCheck(facts)
  if (days === null) return 'never checked'
  return days === 0 ? 'checked today' : `checked ${days} ${days === 1 ? 'day' : 'days'} ago`
}

function summaryLine(facts: UpdatesFacts): string {
  const security = securityUpdates(facts).map((item) => item.name)
  const others = facts.packages.filter((item) => !item.security).map((item) => item.name)
  return [
    security.length > 0 ? `${nameList(security, 3)} (security)` : null,
    others.length > 0 ? nameList(others, 3) : null,
    facts.rebootRequired ? 'reboot needed' : 'no reboot needed',
    checkedText(facts)
  ].filter(Boolean).join(' · ')
}

function UpdateList({ packages, onInstall }: { packages: UpgradePackage[]; onInstall(names: string[]): void }) {
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const toggle = (name: string) => setChosen((previous) => {
    const next = new Set(previous)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    return next
  })
  return (
    <div className="flex flex-col gap-2 border-t border-nd-border pt-3">
      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {packages.map((item) => (
          <li key={item.name}>
            <label className="grid cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] px-2 py-1.5 hover:bg-nd-surface-hover">
              <input type="checkbox" checked={chosen.has(item.name)} onChange={() => toggle(item.name)} aria-label={`Select ${item.name}`} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-mono text-[12.5px] text-nd-text-primary">{item.name}</span>
                <span className="truncate font-mono text-xs text-nd-text-muted">{item.from || 'new'} → {item.to}</span>
              </span>
              {item.security && <Chip tone="warning" dense>security</Chip>}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button size="sm" disabled={chosen.size === 0} onClick={() => onInstall([...chosen])}>Install selected ({chosen.size})</Button>
      </div>
    </div>
  )
}

function RestartNotice({ facts, run }: { facts: UpdatesFacts; run: SoftwareState['run'] }) {
  const services = facts.needRestart.services
  if (services.length === 0) return null
  const action = <Button size="sm" onClick={() => run('software.restart-services', { services })}>Restart</Button>
  return <Notice tone="warning" title={`${services.length} ${services.length === 1 ? 'service still uses' : 'services still use'} old libraries`} action={action}><span className="font-mono text-xs">{nameList(services, 6)}</span></Notice>
}

function RebootNotice({ facts }: { facts: UpdatesFacts }) {
  if (!facts.rebootRequired && facts.needRestart.kernel !== 'pending') return null
  const detail = facts.rebootPackages.length > 0 ? `Needed by ${nameList(facts.rebootPackages, 4)}.` : 'A newer kernel is installed but not running yet.'
  return <Notice tone="warning" title="Reboot needed">{detail}</Notice>
}

function Banner({ facts, run }: { facts: UpdatesFacts; run: SoftwareState['run'] }) {
  const [listOpen, setListOpen] = useState(false)
  const security = securityUpdates(facts)
  const count = facts.packages.length
  const tone = security.length > 0 ? 'warning' : count > 0 ? 'info' : 'neutral'
  const checkNow = <Button size="sm" variant="ghost" onClick={() => run('software.check-updates', {})}>Check now</Button>
  return (
    <section aria-label="System updates" className={cn('flex flex-col gap-3 rounded-xl border px-4 py-3.5', CALLOUT_TONE[tone])}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-semibold text-nd-text-primary">
            {count === 0 ? 'System is up to date' : `${count} system ${count === 1 ? 'update' : 'updates'}${security.length > 0 ? ` · ${security.length} security` : ''}`}
          </span>
          <span className="text-xs text-nd-text-muted">{count === 0 ? checkedText(facts) : summaryLine(facts)}</span>
          {facts.held.length > 0 && <span className="text-xs text-nd-text-muted">Held, will not change: <span className="font-mono">{facts.held.join(', ')}</span></span>}
        </div>
        {checkNow}
        {count > 0 && <Button size="sm" onClick={() => setListOpen((open) => !open)} aria-expanded={listOpen}>{listOpen ? 'Hide list' : 'See list'}</Button>}
        {security.length > 0 && <Button size="sm" onClick={() => run('software.upgrade', { mode: 'security' })}>Security only</Button>}
        {count > 0 && <Button size="sm" variant="primary" onClick={() => run('software.upgrade', { mode: 'all' })}>Install all {count}</Button>}
      </div>
      {listOpen && <UpdateList packages={facts.packages} onInstall={(packages) => run('software.upgrade', { mode: 'selected', packages })} />}
    </section>
  )
}

export function UpdatesBanner({ state }: { state: SoftwareState }) {
  return (
    <ProbeState result={state.updates} label="system updates">
      {(facts) => facts.supported ? (
        <div className="flex flex-col gap-2">
          <Banner facts={facts} run={state.run} />
          <RebootNotice facts={facts} />
          <RestartNotice facts={facts} run={state.run} />
        </div>
      ) : (
        <Notice tone="neutral" title="System updates are unavailable on this OS">Updates are managed with apt, which works on Ubuntu and Debian.</Notice>
      )}
    </ProbeState>
  )
}
