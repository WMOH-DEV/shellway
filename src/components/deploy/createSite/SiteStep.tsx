import { Globe } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Toggle } from '@/components/ui/Toggle'
import { formatBytes } from '@/components/monitor/MonitorCharts'
import { StepHeading } from '@/components/ssl/https/StepHeading'
import type { ServerTools } from '@/types/createSite'
import { DEFAULT_SITE_USER } from '@/utils/createSite/wizard'
import { Section } from '../setup/SiteSections'
import { CodeSection } from './CodeSection'
import { NameStatus } from './NameStatus'
import type { CreateSiteDraftModel } from './useCreateSiteDraft'

interface SiteStepProps {
  model: CreateSiteDraftModel
  tools: ServerTools
  serverIp: string | null
  siteUsers: string[] | null
}

const NEW_USER = ':new'

function SiteUserSection({ model, siteUsers }: { model: CreateSiteDraftModel; siteUsers: string[] }) {
  const { draft, patch } = model
  const options = [...siteUsers.map((name) => ({ value: name, label: name })), { value: NEW_USER, label: 'New user…' }]
  const choose = (value: string) => patch(value === NEW_USER
    ? { newSiteUser: true, siteUser: siteUsers.includes(DEFAULT_SITE_USER) ? '' : DEFAULT_SITE_USER }
    : { newSiteUser: false, siteUser: value })
  return (
    <Section title="Site user">
      <span className="text-xs text-nd-text-muted">You are logged in as root, and a site cannot run as root. This user owns the site folder, and PHP-FPM, the scheduler, the queue worker and every deploy run as it.</span>
      <div className="grid grid-cols-[220px_220px] gap-3">
        <Select label="Runs as" value={draft.newSiteUser ? NEW_USER : draft.siteUser} options={options} onChange={(e) => choose(e.target.value)} />
        {draft.newSiteUser && <Input label="New user name" spellCheck={false} placeholder={DEFAULT_SITE_USER} value={draft.siteUser} onChange={(e) => patch({ siteUser: e.target.value.trim() })} />}
      </div>
    </Section>
  )
}

function AddressSection({ model, tools, serverIp }: Omit<SiteStepProps, 'siteUsers'>) {
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
        <Toggle checked={draft.includeWww} onChange={model.changeWww} label={`Also www.${draft.domain || 'your domain'}`} />
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

export function SiteStep({ model, tools, serverIp, siteUsers }: SiteStepProps) {
  return (
    <div className="flex flex-col gap-5">
      <StepHeading title="Site and code" subtitle="Start with the address, then where the code comes from. Shellway fills in the rest; you can change any of it." />
      <AddressSection model={model} tools={tools} serverIp={serverIp} />
      <CodeSection model={model} />
      {siteUsers !== null && <SiteUserSection model={model} siteUsers={siteUsers} />}
    </div>
  )
}
