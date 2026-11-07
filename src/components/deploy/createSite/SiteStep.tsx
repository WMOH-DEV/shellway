import { Globe } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Toggle } from '@/components/ui/Toggle'
import { formatBytes } from '@/components/monitor/MonitorCharts'
import { StepHeading } from '@/components/ssl/https/StepHeading'
import type { PhpTools, ServerTools } from '@/types/createSite'
import { TEMPLATES, usesPhp } from '@/utils/createSite/templates'
import { toInt } from '../setup/SiteSections'
import { NameStatus } from './NameStatus'
import { TemplateCards } from './TemplateCards'
import type { CreateSiteDraftModel } from './useCreateSiteDraft'

interface SiteStepProps {
  model: CreateSiteDraftModel
  tools: ServerTools
  serverLabel: string
  serverName: string
}

function AddressSection({ model, tools }: Pick<SiteStepProps, 'model' | 'tools'>) {
  const { draft } = model
  return (
    <section aria-label="Address" className="flex flex-col gap-3.5 rounded-[10px] border border-nd-border bg-nd-surface p-4">
      <div className="flex flex-col gap-1.5">
        <Input
          label="Domain"
          placeholder="shop.example.com"
          spellCheck={false}
          icon={<Globe size={14} />}
          value={draft.domain}
          onChange={(e) => model.changeDomain(e.target.value)}
          onBlur={() => void model.checkName()}
          onKeyDown={(e) => e.key === 'Enter' && void model.checkName()}
        />
        {draft.domain !== '' && <NameStatus domain={draft.domain} check={model.nameCheck} checking={model.checking} onRecheck={() => void model.checkName()} />}
      </div>
      <div className="flex flex-col gap-0.5">
        <Toggle checked={draft.includeWww} onChange={(includeWww) => model.patch({ includeWww })} label={`Also www.${draft.domain || 'your domain'}`} />
        <span className="pl-[46px] text-xs text-nd-text-muted">Serves the same site and gets the same certificate</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
        <Input label="Site name" spellCheck={false} value={draft.siteName} onChange={(e) => model.changeSiteName(e.target.value)} />
        <div className="flex flex-col gap-1">
          <Input label="Folder" spellCheck={false} value={draft.folder} onChange={(e) => model.changeFolder(e.target.value)} />
          <span className="text-xs text-nd-text-muted">{formatBytes(tools.freeDiskBytes, 0)} free</span>
        </div>
      </div>
    </section>
  )
}

function phpOptions({ installed, installable }: PhpTools) {
  return [
    ...installed.map((version) => ({ value: version, label: `${version} · installed` })),
    ...installable.map((version) => ({ value: version, label: `${version} · will be installed` }))
  ]
}

function TemplateSettings({ model, tools }: Pick<SiteStepProps, 'model' | 'tools'>) {
  const { draft } = model
  const template = TEMPLATES[draft.template]
  if (!usesPhp(template) && !template.proxiesToApp) return null
  return (
    <div className="grid grid-cols-[220px] gap-3">
      {usesPhp(template) && (
        <Select label="PHP version" value={draft.phpVersion} options={phpOptions(tools.php)} onChange={(e) => model.patch({ phpVersion: e.target.value })} />
      )}
      {template.proxiesToApp && (
        <Input label="App port" type="number" min={1} max={65535} value={draft.appPort} onChange={(e) => model.patch({ appPort: toInt(e.target.value, 0) })} />
      )}
    </div>
  )
}

export function SiteStep({ model, tools, serverLabel, serverName }: SiteStepProps) {
  return (
    <div className="flex flex-col gap-5">
      <StepHeading title="Site and template" subtitle="Start with the address. Shellway fills in the rest; you can change any of it." />
      <AddressSection model={model} tools={tools} />
      <TemplateCards value={model.draft.template} tools={tools} serverLabel={serverLabel} serverName={serverName} onChange={(template) => model.patch({ template })} />
      <TemplateSettings model={model} tools={tools} />
    </div>
  )
}
