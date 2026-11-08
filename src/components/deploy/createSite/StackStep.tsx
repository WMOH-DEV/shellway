import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Toggle } from '@/components/ui/Toggle'
import { StepHeading } from '@/components/ssl/https/StepHeading'
import type { CodeSource, PhpTools, ServerTools, TemplateId } from '@/types/createSite'
import { TEMPLATE_IDS, allowedTemplates } from '@/utils/createSite/wizard'
import { compareVersions } from '@/utils/createSite/php'
import { TEMPLATES, usesPhp } from '@/utils/createSite/templates'
import { Choice, Section, toInt } from '../setup/SiteSections'
import { TemplateCards } from './TemplateCards'
import type { CreateSiteDraftModel, RepoRead } from './useCreateSiteDraft'

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

const repoPhpMinimum = (read: RepoRead | null): string | null => (read?.status === 'read' ? read.suggestion.phpMinimum : null)

function PhpMinimumNote({ minimum, version }: { minimum: string | null; version: string }) {
  if (minimum === null || version === '' || compareVersions(version, minimum) >= 0) return null
  return <span className="text-2xs text-nd-warning-fg">composer.json asks for PHP {minimum} or newer, so composer install will fail on {version}.</span>
}

function TemplateSettings({ model, tools }: Pick<StackStepProps, 'model' | 'tools'>) {
  const { draft } = model
  const template = TEMPLATES[draft.template]
  if (!usesPhp(template) && !template.proxiesToApp) return null
  return (
    <div className="grid grid-cols-[220px] gap-3">
      {usesPhp(template) && (
        <div className="flex flex-col gap-1">
          <Select label="PHP version" value={draft.phpVersion} options={phpOptions(tools.php)} onChange={(e) => model.patch({ phpVersion: e.target.value })} />
          <PhpMinimumNote minimum={repoPhpMinimum(model.repoRead)} version={draft.phpVersion} />
        </div>
      )}
      {template.proxiesToApp && (
        <Input label="App port" type="number" min={1} max={65535} value={draft.appPort} onChange={(e) => model.patch({ appPort: toInt(e.target.value, 0) })} />
      )}
    </div>
  )
}

type StaticKind = 'files' | 'built'

const STATIC_KINDS: { value: StaticKind; label: string; hint: string }[] = [
  { value: 'files', label: 'Plain files', hint: 'The repository already holds the finished site. It is served as it is.' },
  { value: 'built', label: 'Built with npm', hint: 'Each deploy runs npm ci and npm run build on the server, then serves the folder the build writes, as with Vite or React.' }
]

function StaticSettings({ model, tools }: Pick<StackStepProps, 'model' | 'tools'>) {
  const { draft, patch } = model
  if (draft.template !== 'static') return null
  if (draft.codeSource !== 'git') return <SpaToggle model={model} />
  return (
    <Section title="How the site is made">
      <Choice value={draft.staticBuild ? 'built' : 'files'} options={STATIC_KINDS} onChange={(kind) => patch({ staticBuild: kind === 'built', commands: null })} />
      {draft.staticBuild && (
        <div className="grid grid-cols-[220px] gap-3">
          <Input label="Build output folder" value={draft.outputDir} onChange={(e) => patch({ outputDir: e.target.value })} />
        </div>
      )}
      {draft.staticBuild && tools.node === null && <span className="text-2xs text-nd-text-muted">Node.js is not installed on this server, so it cannot build the site.</span>}
      <SpaToggle model={model} />
    </Section>
  )
}

function SpaToggle({ model }: { model: CreateSiteDraftModel }) {
  return <Toggle checked={model.draft.spa} onChange={(spa) => model.patch({ spa })} label="Single-page app: send every unknown path to index.html" />
}

const NOT_HERE: Record<Exclude<CodeSource, 'git'>, string> = {
  new: 'Needs your own repository',
  none: 'Needs code'
}

function notHere(source: CodeSource): Partial<Record<TemplateId, string>> {
  if (source === 'git') return {}
  const allowed = allowedTemplates(source)
  return Object.fromEntries(TEMPLATE_IDS.filter((id) => !allowed.includes(id)).map((id) => [id, NOT_HERE[source]]))
}

function RepoNote({ read, model }: { read: RepoRead; model: CreateSiteDraftModel }) {
  if (read.status === 'reading') return <p className="text-xs text-nd-text-muted">Reading the repository on this PC to suggest a stack…</p>
  if (read.status === 'failed') {
    return (
      <div role="status" className="flex items-center gap-2 text-xs text-nd-text-muted">
        <span className="min-w-0 truncate" title={read.error}>Could not read the repository from this PC, so pick the stack yourself. {read.error}</span>
        <Button size="sm" variant="ghost" onClick={() => void model.readRepo()}>Try again</Button>
      </div>
    )
  }
  const { suggestion } = read
  if (suggestion.template === null) return <p role="status" className="text-xs text-nd-text-muted">Shellway could not tell the stack from the repository. {suggestion.reason} Pick one below.</p>
  const label = TEMPLATES[suggestion.template].label
  if (suggestion.template === model.draft.template) return <p role="status" className="text-xs text-nd-text-muted">{label} matches the repository. {suggestion.reason} Change it if that is wrong.</p>
  return (
    <div role="status" className="flex items-center gap-2 text-xs text-nd-text-primary">
      <span>The repository looks like {label}. {suggestion.reason}</span>
      <Button size="sm" onClick={() => model.applySuggestion(suggestion)}>Use {label}</Button>
    </div>
  )
}

export function StackStep({ model, tools, serverLabel, serverName }: StackStepProps) {
  const { readRepo, repoRead, draft } = model
  const isGit = draft.codeSource === 'git'
  useEffect(() => {
    if (isGit) void readRepo()
  }, [isGit])
  return (
    <div className="flex flex-col gap-5">
      <StepHeading title="Stack" subtitle="What the code is built with. It decides what gets installed, how the web server runs the site and which commands run on each deploy." />
      {isGit && repoRead !== null && <RepoNote read={repoRead} model={model} />}
      <TemplateCards value={draft.template} tools={tools} serverLabel={serverLabel} serverName={serverName} notHere={notHere(draft.codeSource)} onChange={model.pickTemplate} />
      <TemplateSettings model={model} tools={tools} />
      <StaticSettings model={model} tools={tools} />
    </div>
  )
}
