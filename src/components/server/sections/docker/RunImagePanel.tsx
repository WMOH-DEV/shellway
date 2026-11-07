import { useState, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Toggle } from '@/components/ui/Toggle'
import { CodeBox, Label, Notice } from '@/components/server/kit'
import { envFilePath, RESTART_POLICIES, type RestartPolicy, type RunParams } from '@/utils/server/docker/actions/run'
import { formatSize } from '@/utils/server/docker/size'
import { EMPTY_RUN_FORM, emptyEnv, emptyPort, emptyVolume, runPreview, suggestName, type EnvRow, type PortRow, type RunForm, type VolumeRow } from '@/utils/server/docker/runForm'
import { serverApi } from '../../serverApi'
import { SidePanel } from './SidePanel'

const RESTART_LABELS: Record<RestartPolicy, string> = {
  'unless-stopped': 'unless stopped',
  always: 'always',
  'on-failure': 'on failure',
  no: 'never'
}

type TagCheck = { state: 'idle' } | { state: 'checking' } | { state: 'done'; text: string; ok: boolean }

export interface RunRequest {
  params: RunParams
  form: RunForm
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function RemoveRow({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="rounded-md p-1 text-nd-text-muted hover:bg-nd-surface-hover hover:text-nd-text-primary">
      <X size={14} />
    </button>
  )
}

function AddRow({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 self-start text-xs text-nd-accent hover:underline">
      <Plus size={12} />{label}
    </button>
  )
}

function replaceAt<T>(rows: T[], index: number, patch: Partial<T>): T[] {
  return rows.map((row, position) => (position === index ? { ...row, ...patch } : row))
}

const withoutIndex = <T,>(rows: T[], index: number): T[] => rows.filter((_, position) => position !== index)

function PortsField({ rows, onChange }: { rows: PortRow[]; onChange(rows: PortRow[]): void }) {
  return (
    <Field label="Ports">
      {rows.map((row, index) => (
        <div key={index} className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 font-mono text-xs text-nd-text-muted">{row.isPublic ? '0.0.0.0' : '127.0.0.1'}:</span>
            <Input aria-label="Server port" placeholder="8081" value={row.host} onChange={(event) => onChange(replaceAt(rows, index, { host: event.target.value }))} className="font-mono" />
            <span className="text-nd-text-muted">→</span>
            <Input aria-label="Container port" placeholder="8080" value={row.container} onChange={(event) => onChange(replaceAt(rows, index, { container: event.target.value }))} className="font-mono" />
            <RemoveRow label="Remove port" onClick={() => onChange(withoutIndex(rows, index))} />
          </div>
          <div className="flex items-center gap-2 pl-[88px] text-xs text-nd-text-muted">
            <Toggle checked={row.isPublic} onChange={(isPublic) => onChange(replaceAt(rows, index, { isPublic }))} ariaLabel="Open to the internet" />
            {row.isPublic ? <span className="text-nd-warning-fg">Open to the internet. Docker skips the ufw firewall.</span> : <span>Local only. A site proxy can expose it.</span>}
          </div>
        </div>
      ))}
      <AddRow label="Add port" onClick={() => onChange([...rows, emptyPort()])} />
    </Field>
  )
}

function VolumesField({ rows, onChange }: { rows: VolumeRow[]; onChange(rows: VolumeRow[]): void }) {
  return (
    <Field label="Volumes">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input aria-label="Folder or volume name" placeholder="/srv/app/data or app-data" value={row.source} onChange={(event) => onChange(replaceAt(rows, index, { source: event.target.value }))} className="font-mono" />
          <span className="text-nd-text-muted">→</span>
          <Input aria-label="Path in the container" placeholder="/data" value={row.target} onChange={(event) => onChange(replaceAt(rows, index, { target: event.target.value }))} className="font-mono" />
          <RemoveRow label="Remove volume" onClick={() => onChange(withoutIndex(rows, index))} />
        </div>
      ))}
      <AddRow label="Add volume" onClick={() => onChange([...rows, emptyVolume()])} />
    </Field>
  )
}

function EnvField({ rows, name, onChange }: { rows: EnvRow[]; name: string; onChange(rows: EnvRow[]): void }) {
  return (
    <Field label="Environment">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input aria-label="Variable name" placeholder="APP_ENV" value={row.key} onChange={(event) => onChange(replaceAt(rows, index, { key: event.target.value }))} className="font-mono" />
          <span className="text-nd-text-muted">=</span>
          <Input aria-label="Value" type="password" autoComplete="off" value={row.value} onChange={(event) => onChange(replaceAt(rows, index, { value: event.target.value }))} className="font-mono" />
          <RemoveRow label="Remove variable" onClick={() => onChange(withoutIndex(rows, index))} />
        </div>
      ))}
      <AddRow label="Add variable" onClick={() => onChange([...rows, emptyEnv()])} />
      {rows.length > 0 && <span className="text-xs text-nd-text-muted">Stored in <span className="font-mono">{envFilePath(name || 'name')}</span> (0600), not on the command line.</span>}
    </Field>
  )
}

function tagCheckText(found: boolean, size: number | null, platforms: number): string {
  if (!found) return 'not found'
  if (size !== null) return `found · ${formatSize(size)}`
  return `found · ${platforms} platforms`
}

function ImageField({ connectionId, value, onChange, onBlur }: { connectionId: string; value: string; onChange(value: string): void; onBlur(): void }) {
  const [check, setCheck] = useState<TagCheck>({ state: 'idle' })
  const run = async () => {
    setCheck({ state: 'checking' })
    const result = await serverApi().docker.manifest(connectionId, value.trim())
    if (!result.success) return setCheck({ state: 'done', ok: false, text: result.error })
    setCheck({ state: 'done', ok: result.data.found, text: tagCheckText(result.data.found, result.data.size, result.data.platforms) })
  }
  return (
    <Field label="Image">
      <div className="flex items-center gap-2">
        <Input aria-label="Image and tag" placeholder="acme/api:2.1" value={value} onBlur={onBlur} onChange={(event) => { onChange(event.target.value); setCheck({ state: 'idle' }) }} className="font-mono" />
        <Button size="sm" variant="ghost" disabled={!value.trim() || check.state === 'checking'} onClick={() => void run()}>Check tag</Button>
      </div>
      {check.state === 'checking' && <span className="text-xs text-nd-text-muted">Checking the registry…</span>}
      {check.state === 'done' && <span className={check.ok ? 'text-xs text-nd-success-fg' : 'text-xs text-nd-warning-fg'}>{check.text}</span>}
    </Field>
  )
}

export function RunImagePanel({ connectionId, onClose, onRun }: { connectionId: string; onClose(): void; onRun(request: RunRequest): void }) {
  const [form, setForm] = useState<RunForm>(EMPTY_RUN_FORM)
  const update = (patch: Partial<RunForm>) => setForm((previous) => ({ ...previous, ...patch }))
  const preview = runPreview(form, false)
  const submit = (saveAsCompose: boolean) => {
    const result = runPreview(form, saveAsCompose)
    if (result.ok) onRun({ params: result.params, form })
  }

  const footer = (
    <>
      <Button variant="ghost" disabled={!preview.ok} onClick={() => submit(true)}>Save as compose stack</Button>
      <div className="flex-1" />
      <Button variant="primary" disabled={!preview.ok} onClick={() => submit(false)}>Run</Button>
    </>
  )

  return (
    <SidePanel title="Run an image" label="Run an image" onClose={onClose} footer={footer}>
      <ImageField connectionId={connectionId} value={form.reference} onChange={(reference) => update({ reference })} onBlur={() => !form.name && update({ name: suggestName(form.reference) })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input aria-label="Container name" value={form.name} placeholder="acme-api" onChange={(event) => update({ name: event.target.value })} className="font-mono" />
        </Field>
        <Field label="Restart">
          <Select aria-label="Restart policy" value={form.restart} onChange={(event) => update({ restart: event.target.value as RestartPolicy })} options={RESTART_POLICIES.map((value) => ({ value, label: RESTART_LABELS[value] }))} />
        </Field>
      </div>
      <PortsField rows={form.ports} onChange={(ports) => update({ ports })} />
      <VolumesField rows={form.volumes} onChange={(volumes) => update({ volumes })} />
      <EnvField rows={form.env} name={form.name || suggestName(form.reference)} onChange={(env) => update({ env })} />
      <div className="flex flex-col gap-2">
        <Toggle checked={form.onDomain} onChange={(onDomain) => update({ onDomain })} label="Put it on a domain with HTTPS" />
        <span className="text-xs text-nd-text-muted">After it starts, opens Create site with a proxy to the first port, DNS and a certificate.</span>
        {form.onDomain && <Input aria-label="Domain" placeholder="app.example.com" value={form.domain} onChange={(event) => update({ domain: event.target.value })} className="font-mono" />}
      </div>
      <Field label="Will run">
        {preview.ok ? <CodeBox text={preview.text} label="command" /> : form.reference.trim() ? <Notice tone="warning">{preview.error}</Notice> : <span className="text-xs text-nd-text-muted">Enter an image to see the command.</span>}
      </Field>
    </SidePanel>
  )
}
