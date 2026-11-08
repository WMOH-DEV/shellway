import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { StepHeading } from '@/components/ssl/https/StepHeading'
import type { PhpTools, ServerTools } from '@/types/createSite'
import { defaultDatabase } from '@/utils/createSite/database'
import { TEMPLATES, usesPhp } from '@/utils/createSite/templates'
import { toInt } from '../setup/SiteSections'
import { TemplateCards } from './TemplateCards'
import type { CreateSiteDraftModel } from './useCreateSiteDraft'

interface StackStepProps {
  model: CreateSiteDraftModel
  tools: ServerTools
  serverLabel: string
  serverName: string
}

function phpOptions({ installed, installable }: PhpTools) {
  return [
    ...installed.map((version) => ({ value: version, label: `${version} · installed` })),
    ...installable.map((version) => ({ value: version, label: `${version} · will be installed` }))
  ]
}

function TemplateSettings({ model, tools }: Pick<StackStepProps, 'model' | 'tools'>) {
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

export function StackStep({ model, tools, serverLabel, serverName }: StackStepProps) {
  return (
    <div className="flex flex-col gap-5">
      <StepHeading title="Stack" subtitle="What the code is built with. It decides what gets installed, how the web server runs the site and which commands run on each deploy." />
      <TemplateCards value={model.draft.template} tools={tools} serverLabel={serverLabel} serverName={serverName} onChange={(template) => model.patch({ template, commands: null, database: defaultDatabase(template, tools) })} />
      <TemplateSettings model={model} tools={tools} />
    </div>
  )
}
