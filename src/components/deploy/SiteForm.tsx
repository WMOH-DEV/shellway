import { useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Toggle } from '@/components/ui/Toggle'
import { cn } from '@/utils/cn'
import type { DeployLayout, SiteConfig, SourceMode } from '@/types/deploy'
import { PRESETS, applyPreset, newSite, presetById, siteNameFromPath, suggestPreset, type PresetId } from '@/utils/deploy/presets'
import { githubSshUrl, isHttpUrl, parseGitHubRepo } from '@/utils/deploy/githubRepo'
import { StepsEditor } from './StepsEditor'
import { deployApi } from './useDeploySites'

interface SiteFormProps {
  connectionId: string
  initial: SiteConfig | null
  existingNames: string[]
  onSaved: (site: SiteConfig, isNew: boolean) => void
  onCancel: () => void
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-nd-border bg-nd-bg-secondary p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-nd-text-muted">{title}</h3>
      {children}
    </section>
  )
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; hint: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md border p-2.5 text-left transition-colors',
            value === option.value ? 'border-nd-accent bg-nd-accent/10' : 'border-nd-border hover:border-nd-border-hover'
          )}
        >
          <div className="text-xs font-medium text-nd-text-primary">{option.label}</div>
          <div className="mt-0.5 text-2xs text-nd-text-muted">{option.hint}</div>
        </button>
      ))}
    </div>
  )
}

const SOURCE_OPTIONS: { value: SourceMode; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto on the server', hint: 'The server checks for new commits and deploys by itself, even when your PC is off. Uses a read-only key for this one repo.' },
  { value: 'pc', label: 'From my PC', hint: 'Shellway sends the code over SSH. The server gets no access to your git host. Deploys only while Shellway is open.' }
]

const LAYOUT_OPTIONS: { value: DeployLayout; label: string; hint: string }[] = [
  { value: 'releases', label: 'Releases', hint: 'Builds in a new folder, then switches. A failed build never touches the live site. Rollback takes a second.' },
  { value: 'inplace', label: 'In place', hint: 'Updates the folder directly, like a manual git pull. Rollback rebuilds the older commit.' }
]

const toInt = (value: string, fallback: number) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function SiteForm({ connectionId, initial, existingNames, onSaved, onCancel }: SiteFormProps) {
  const isNew = initial === null
  const [site, setSite] = useState<SiteConfig>(() => initial ?? applyPreset(newSite(), 'laravel', { buildScript: false }))
  const [preset, setPreset] = useState<PresetId>('laravel')
  const [buildScript, setBuildScript] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [detectNote, setDetectNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sharedPathsText, setSharedPathsText] = useState(() => site.sharedPaths.join(' '))
  const [nameEdited, setNameEdited] = useState(false)

  const patch = (changes: Partial<SiteConfig>) => setSite((current) => ({ ...current, ...changes }))
  const github = parseGitHubRepo(site.repoUrl)
  const needsSshUrl = site.sourceMode === 'auto' && isHttpUrl(site.repoUrl)

  const choosePreset = (id: PresetId) => {
    setPreset(id)
    const next = applyPreset(site, id, { buildScript })
    setSharedPathsText(next.sharedPaths.join(' '))
    setSite(next)
  }

  const detect = async () => {
    setDetecting(true)
    setDetectNote(null)
    const result = await deployApi().detect(connectionId, site.path)
    setDetecting(false)
    if (!result.success || !result.data) {
      setDetectNote(result.error ?? 'Could not inspect the folder')
      return
    }
    const found = result.data
    if (!found.exists) {
      setDetectNote('This folder does not exist yet. It will be created on the first deploy.')
      return
    }
    if (!isNew) {
      patch({ repoUrl: found.repoUrl || site.repoUrl, branch: found.branch || site.branch })
      setDetectNote(found.repoUrl ? `Found ${found.repoUrl} on ${found.branch || 'unknown branch'}` : 'No git repository here')
      return
    }
    const suggested = suggestPreset(found.files)
    setBuildScript(found.buildScript)
    setPreset(suggested)
    setSharedPathsText(presetById(suggested).sharedPaths.join(' '))
    setSite((current) => ({
      ...applyPreset(current, suggested, { buildScript: found.buildScript }),
      name: current.name || siteNameFromPath(current.path),
      repoUrl: found.repoUrl || current.repoUrl,
      branch: found.branch || current.branch
    }))
    const presetLabel = PRESETS.find((p) => p.id === suggested)?.label
    setDetectNote(found.repoUrl ? `Found ${found.repoUrl} on ${found.branch || 'unknown branch'} · ${presetLabel}` : `No git repository here · ${presetLabel}`)
  }

  const save = async () => {
    if (isNew && existingNames.includes(site.name)) {
      setError('A site with this name already exists on this server')
      return
    }
    setSaving(true)
    setError(null)
    const result = await deployApi().save(connectionId, site)
    setSaving(false)
    if (!result.success) {
      setError(result.error ?? 'Could not save')
      return
    }
    onSaved(site, isNew)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-nd-border px-4 py-2.5">
        <Button size="sm" variant="ghost" onClick={onCancel}><ArrowLeft size={13} /> Back</Button>
        <h2 className="text-sm font-semibold text-nd-text-primary">{isNew ? 'Add site' : `Edit ${site.name}`}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <Section title="Where">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label="Folder the web server serves"
                  placeholder="/var/www/example_app"
                  value={site.path}
                  onChange={(e) => patch({ path: e.target.value, ...(isNew && !nameEdited && { name: siteNameFromPath(e.target.value) }) })}
                />
              </div>
              <Button onClick={() => void detect()} disabled={!site.path.startsWith('/') || detecting}>
                <Search size={13} /> {detecting ? 'Checking…' : 'Detect'}
              </Button>
            </div>
            {detectNote && <div className="text-2xs text-nd-text-secondary">{detectNote}</div>}
            <div className="grid grid-cols-2 gap-3">
              <Input label="Site name" value={site.name} disabled={!isNew} onChange={(e) => { setNameEdited(true); patch({ name: e.target.value }) }} />
              {isNew && (
                <Select
                  label="Type"
                  value={preset}
                  options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
                  onChange={(e) => choosePreset(e.target.value as PresetId)}
                />
              )}
            </div>
          </Section>

          <Section title="Code">
            <div className="grid grid-cols-[1fr_160px] gap-3">
              <Input label="Repository" placeholder="git@github.com:owner/repo.git" value={site.repoUrl} onChange={(e) => patch({ repoUrl: e.target.value.trim() })} />
              <Input label="Branch" value={site.branch} onChange={(e) => patch({ branch: e.target.value.trim() })} />
            </div>
            <Choice value={site.sourceMode} options={SOURCE_OPTIONS} onChange={(sourceMode) => patch({ sourceMode })} />
            {needsSshUrl && (
              <div className="flex items-center gap-2 rounded-md border border-nd-warning/40 bg-nd-warning/10 p-2 text-2xs text-nd-warning">
                <AlertTriangle size={13} />
                <span className="flex-1">Deploy keys only work with SSH repository URLs.</span>
                {github && <Button size="sm" variant="secondary" onClick={() => patch({ repoUrl: githubSshUrl(github) })}>Use SSH URL</Button>}
              </div>
            )}
            {site.sourceMode === 'auto' && (
              <Input
                label="Check for new commits every (minutes)"
                type="number" min={1} max={60}
                value={site.pollMinutes}
                onChange={(e) => patch({ pollMinutes: toInt(e.target.value, 1) })}
              />
            )}
            {site.sourceMode === 'pc' && (
              <Toggle checked={site.pcAuto} onChange={(pcAuto) => patch({ pcAuto })} label="Deploy new commits automatically while Shellway is open and connected" />
            )}
          </Section>

          <Section title="Folder layout">
            <Choice value={site.layout} options={LAYOUT_OPTIONS} onChange={(layout) => patch({ layout })} />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Kept between deploys (space separated)"
                placeholder=".env storage"
                value={sharedPathsText}
                onChange={(e) => { setSharedPathsText(e.target.value); patch({ sharedPaths: e.target.value.split(/\s+/).filter(Boolean) }) }}
              />
              <Input label="Env file" value={site.envFile} onChange={(e) => patch({ envFile: e.target.value.trim() })} />
            </div>
            {site.layout === 'releases' && (
              <Input label="Releases to keep" type="number" min={1} max={50} value={site.keepReleases} onChange={(e) => patch({ keepReleases: toInt(e.target.value, 5) })} />
            )}
          </Section>

          <Section title="Commands">
            <StepsEditor
              connectionId={connectionId}
              title="Build"
              hint="Runs on the new code before it goes live. A required command failing stops the deploy and the live site stays as it was."
              steps={site.buildSteps}
              onChange={(buildSteps) => patch({ buildSteps })}
            />
            <div className="border-t border-nd-border" />
            <StepsEditor
              connectionId={connectionId}
              title="After going live"
              hint="Runs right after the new code is live: migrations, caches, restarting workers."
              steps={site.activateSteps}
              onChange={(activateSteps) => patch({ activateSteps })}
            />
          </Section>

          <Section title="Safety">
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <Input label="Health check URL (optional)" placeholder="https://app.example.com/up" value={site.healthUrl} onChange={(e) => patch({ healthUrl: e.target.value.trim() })} />
              <Input label="Expected status" type="number" value={site.healthStatus} onChange={(e) => patch({ healthStatus: toInt(e.target.value, 200) })} />
            </div>
            {site.layout === 'releases' && (
              <Toggle checked={site.autoRevert} onChange={(autoRevert) => patch({ autoRevert })} label="Switch back to the previous release if a required command or the health check fails" />
            )}
            <Toggle
              checked={site.approveMigrations}
              onChange={(approveMigrations) => patch({ approveMigrations })}
              label="Ask me before deploying commits that add or change migrations"
            />
            {site.approveMigrations && (
              <Input label="Migrations folder" value={site.migrationsPath} onChange={(e) => patch({ migrationsPath: e.target.value.trim() })} />
            )}
          </Section>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-nd-border px-4 py-2.5">
        {error && <span className="mr-auto text-xs text-nd-error">{error}</span>}
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save site'}</Button>
      </div>
    </div>
  )
}
