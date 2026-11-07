import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Toggle } from '@/components/ui/Toggle'
import type { ProbeResult } from '@/types/server/core'
import { SWAP_FILE, TIMEZONES_PROBE, type HardeningFacts } from '@/utils/server/security/hardening'
import { SWAP_SIZES } from '@/utils/server/security/hardeningActions'
import { ProbeState, SectionCard, Segmented } from '../../kit'
import { useServerFacts } from '../../useServerFacts'
import type { ServerSectionContext } from '../types'
import { FormModal } from './FormModal'
import type { SecurityActions } from './types'

const GIB = 1024 ** 3
const gigabytes = (bytes: number): string => `${Math.round((bytes / GIB) * 10) / 10} GB`

function Row({ title, detail, control }: { title: string; detail: ReactNode; control: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-nd-border bg-nd-surface px-3 py-2.5">
      <div className="flex w-10 shrink-0 justify-center">{control}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] text-nd-text-primary">{title}</span>
        <span className="truncate text-xs text-nd-text-muted">{detail}</span>
      </div>
    </div>
  )
}

function ValueRow({ title, value, onChange }: { title: string; value: string; onChange(): void }) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-nd-border bg-nd-surface px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] text-nd-text-primary">{title}</span>
        <span className="truncate font-mono text-xs text-nd-text-muted">{value || 'unknown'}</span>
      </div>
      <Button size="sm" variant="ghost" onClick={onChange}>Change</Button>
    </div>
  )
}

function SwapModal({ open, onClose, onPick }: { open: boolean; onClose(): void; onPick(size: number): void }) {
  const [size, setSize] = useState('2')
  return (
    <FormModal open={open} title="Add a swap file" submitLabel="Review" error="" onClose={onClose} onSubmit={() => onPick(Number(size))}>
      <p className="text-[13px] text-nd-text-secondary">Swap lets the server use disk when memory runs out, instead of stopping programs. 1–2 GB is enough for most small servers.</p>
      <Segmented ariaLabel="Swap size" options={SWAP_SIZES.map((value) => ({ value: String(value), label: `${value} GB` }))} value={size} onChange={setSize} />
    </FormModal>
  )
}

function TimezoneModal({ ctx, current, onClose, onPick }: { ctx: ServerSectionContext; current: string; onClose(): void; onPick(zone: string): void }) {
  const [zone, setZone] = useState(current)
  const { facts } = useServerFacts(ctx, [TIMEZONES_PROBE])
  const result = facts[TIMEZONES_PROBE]
  const zones = result?.status === 'ok' ? (result.data as string[]) : []
  const error = zones.length > 0 && zone && !zones.includes(zone) ? 'Pick a time zone from the list' : ''
  return (
    <FormModal open title="Time zone" submitLabel="Review" error={error} onClose={onClose} onSubmit={() => { if (!error && zone) onPick(zone) }}>
      <Input label="Time zone" className="font-mono" list="security-timezones" value={zone} onChange={(event) => setZone(event.target.value)} autoFocus />
      <datalist id="security-timezones">
        {zones.map((name) => <option key={name} value={name} />)}
      </datalist>
      <p className="text-xs text-nd-text-muted">Cron jobs and log times follow this clock.</p>
    </FormModal>
  )
}

function HostnameModal({ current, onClose, onPick }: { current: string; onClose(): void; onPick(name: string): void }) {
  const [name, setName] = useState(current)
  return (
    <FormModal open title="Host name" submitLabel="Review" error="" onClose={onClose} onSubmit={() => onPick(name.trim().toLowerCase())}>
      <Input label="Host name" className="font-mono" placeholder="web-1 or app.example.com" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      <p className="text-xs text-nd-text-muted">Also updates the 127.0.1.1 line in /etc/hosts.</p>
    </FormModal>
  )
}

type Dialog = 'swap' | 'timezone' | 'hostname' | null

function swapDetail(facts: HardeningFacts): string {
  if (facts.swaps.length === 0) return `None. Memory: ${gigabytes(facts.memoryBytes)}`
  const total = facts.swaps.reduce((sum, swap) => sum + swap.sizeBytes, 0)
  return `${gigabytes(total)} on ${facts.swaps.map((swap) => swap.name).join(', ')}${facts.swappiness !== null ? ` · vm.swappiness ${facts.swappiness}` : ''}`
}

function HardeningBody({ ctx, facts, actions }: { ctx: ServerSectionContext; facts: HardeningFacts; actions: SecurityActions }) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const updatesOn = facts.unattendedInstalled && facts.unattendedEnabled
  const ownSwap = facts.swaps.some((swap) => swap.name === SWAP_FILE)
  const swapOn = facts.swaps.length > 0
  const close = () => setDialog(null)
  return (
    <div className="flex flex-col gap-1.5">
      <Row
        title="Automatic security updates"
        detail={updatesOn ? 'unattended-upgrades · security only · no auto reboot' : facts.unattendedInstalled ? 'Installed but turned off' : 'unattended-upgrades is not installed'}
        control={<Toggle ariaLabel="Automatic security updates" checked={updatesOn} onChange={(on) => actions.launch('security.unattended', { enabled: on })} />}
      />
      <Row
        title={facts.rebootRequired ? 'Reboot needed' : 'No reboot needed'}
        detail={facts.rebootRequired ? `For ${facts.rebootPackages.slice(0, 3).join(', ') || 'updated packages'}. Reboot when it suits you.` : 'Updates did not ask for a reboot.'}
        control={<span className={facts.rebootRequired ? 'h-2 w-2 rounded-full bg-nd-warning' : 'h-2 w-2 rounded-full bg-nd-success'} aria-hidden />}
      />
      <Row
        title={swapOn ? 'Swap is on' : 'Swap is off'}
        detail={swapDetail(facts)}
        control={<Toggle ariaLabel="Swap file" checked={swapOn} disabled={swapOn && !ownSwap} onChange={(on) => (on ? setDialog('swap') : actions.launch('security.swap', { sizeGb: 0 }))} />}
      />
      <Row
        title="Time sync"
        detail={facts.ntpEnabled ? (facts.ntpSynchronized ? 'On and in sync. Needed for certificates and logs.' : 'On, not in sync yet.') : 'Off. Certificates and logs need the right time.'}
        control={<Toggle ariaLabel="Time sync" checked={facts.ntpEnabled} disabled={facts.ntpEnabled} onChange={() => actions.launch('security.timesync', {})} />}
      />
      <ValueRow title="Time zone" value={facts.timezone} onChange={() => setDialog('timezone')} />
      <ValueRow title="Host name" value={facts.hostname} onChange={() => setDialog('hostname')} />
      <SwapModal open={dialog === 'swap'} onClose={close} onPick={(sizeGb) => { close(); actions.launch('security.swap', { sizeGb }) }} />
      {dialog === 'timezone' && <TimezoneModal ctx={ctx} current={facts.timezone} onClose={close} onPick={(timezone) => { close(); actions.launch('security.timezone', { timezone }) }} />}
      {dialog === 'hostname' && <HostnameModal current={facts.hostname} onClose={close} onPick={(hostname) => { close(); actions.launch('security.hostname', { hostname }) }} />}
    </div>
  )
}

export function HardeningCard({ ctx, result, actions }: { ctx: ServerSectionContext; result: ProbeResult<HardeningFacts> | undefined; actions: SecurityActions }) {
  return (
    <SectionCard title="Hardening">
      <div id="security-hardening">
        <ProbeState result={result} label="hardening settings">
          {(data) => <HardeningBody ctx={ctx} facts={data} actions={actions} />}
        </ProbeState>
      </div>
    </SectionCard>
  )
}
