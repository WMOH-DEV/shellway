import { Globe } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Toggle } from '@/components/ui/Toggle'
import { formatBytes } from '@/components/monitor/MonitorCharts'
import { StepHeading } from '@/components/ssl/https/StepHeading'
import type { ServerTools } from '@/types/createSite'
import { CodeSection } from './CodeSection'
import { NameStatus } from './NameStatus'
import type { CreateSiteDraftModel } from './useCreateSiteDraft'

interface SiteStepProps {
  model: CreateSiteDraftModel
  tools: ServerTools
  serverIp: string | null
}

function AddressSection({ model, tools, serverIp }: SiteStepProps) {
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
        {draft.domain !== '' && <NameStatus site={draft} serverIp={serverIp} check={model.nameCheck} checking={model.checking} onRecheck={() => void model.checkName()} />}
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

export function SiteStep({ model, tools, serverIp }: SiteStepProps) {
  return (
    <div className="flex flex-col gap-5">
      <StepHeading title="Site and code" subtitle="Start with the address, then where the code comes from. Shellway fills in the rest; you can change any of it." />
      <AddressSection model={model} tools={tools} serverIp={serverIp} />
      <CodeSection model={model} />
    </div>
  )
}
