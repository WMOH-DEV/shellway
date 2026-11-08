import type { ReactNode } from 'react'
import { AlertTriangle, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Toggle } from '@/components/ui/Toggle'
import { cn } from '@/utils/cn'
import type { DeployLayout, SourceMode } from '@/types/deploy'
import { PRESETS, type PresetId } from '@/utils/deploy/presets'
import { githubSshUrl, isHttpUrl, parseGitHubRepo } from '@/utils/deploy/githubRepo'
import { StepsEditor } from '../StepsEditor'
import type { SiteDraft } from './useSiteDraft'

interface SectionProps {
  draft: SiteDraft
}

interface CommandsSectionProps extends SectionProps {
  connectionId: string
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-nd-border bg-nd-surface p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-nd-text-dim">{title}</h3>
      {children}
    </section>
  )
}

export function Choice<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; hint: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md border p-2.5 text-left transition-colors',
            value === option.value ? 'border-nd-accent/70 bg-nd-accent/[0.07]' : 'border-nd-border hover:border-nd-border-hover'
          )}
        >
          <div className="text-xs font-medium text-nd-text-primary">{option.label}</div>
          <div className="mt-0.5 text-2xs text-nd-text-muted">{option.hint}</div>
        </button>
      ))}
    </div>
  )
}

export const SOURCE_OPTIONS: { value: SourceMode; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto on the server', hint: 'The server checks for new commits and deploys by itself, even when your PC is off. Uses a read-only key for this one repo.' },
  { value: 'pc', label: 'From my PC', hint: 'Shellway sends the code over SSH. The server gets no access to your git host. Deploys only while Shellway is open.' }
]

const LAYOUT_OPTIONS: { value: DeployLayout; label: string; hint: string }[] = [
  { value: 'releases', label: 'Releases', hint: 'Builds in a new folder, then switches. A failed build never touches the live site. Rollback takes a second.' },
  { value: 'inplace', label: 'In place', hint: 'Updates the folder directly, like a manual git pull. Rollback rebuilds the older commit.' }
]

export const toInt = (value: string, fallback: number) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function WhereSection({ draft }: SectionProps) {
  const { site, isNew, nameLocked, preset, detecting, detectNote } = draft
  return (
    <Section title="Where">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="Folder the web server serves"
            placeholder="/var/www/example_app"
            value={site.path}
            onChange={(e) => draft.changePath(e.target.value)}
          />
        </div>
        <Button onClick={() => void draft.detect()} disabled={!site.path.startsWith('/') || detecting}>
          <Search size={13} /> {detecting ? 'Checking…' : 'Detect'}
        </Button>
      </div>
      {detectNote && <div className="text-2xs text-nd-text-secondary">{detectNote}</div>}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Site name" value={site.name} disabled={nameLocked} onChange={(e) => draft.changeName(e.target.value)} />
        {isNew && (
          <Select
            label="Type"
            value={preset}
            options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
            onChange={(e) => draft.choosePreset(e.target.value as PresetId)}
          />
        )}
      </div>
    </Section>
  )
}

export function CodeSection({ draft }: SectionProps) {
  const { site, patch } = draft
  const github = parseGitHubRepo(site.repoUrl)
  const needsSshUrl = site.sourceMode === 'auto' && isHttpUrl(site.repoUrl)
  return (
    <Section title="Code">
      <div className="grid grid-cols-[1fr_160px] gap-3">
        <Input label="Repository" placeholder="git@github.com:owner/repo.git" value={site.repoUrl} onChange={(e) => patch({ repoUrl: e.target.value.trim() })} />
        <Input label="Branch" value={site.branch} onChange={(e) => patch({ branch: e.target.value.trim() })} />
      </div>
      <Choice value={site.sourceMode} options={SOURCE_OPTIONS} onChange={(sourceMode) => patch({ sourceMode })} />
      {needsSshUrl && (
        <div className="flex items-center gap-2 rounded-md border border-nd-warning/30 bg-nd-warning/[0.07] p-2 text-2xs text-nd-text-primary">
          <AlertTriangle size={13} className="text-nd-warning-fg" />
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
  )
}

export function LayoutSection({ draft }: SectionProps) {
  const { site, patch } = draft
  return (
    <Section title="Folder layout">
      <Choice value={site.layout} options={LAYOUT_OPTIONS} onChange={(layout) => patch({ layout })} />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Kept between deploys (space separated)"
          placeholder=".env storage"
          value={draft.sharedPathsText}
          onChange={(e) => draft.changeSharedPaths(e.target.value)}
        />
        <Input label="Env file" value={site.envFile} onChange={(e) => patch({ envFile: e.target.value.trim() })} />
      </div>
      {site.layout === 'releases' && (
        <Input label="Releases to keep" type="number" min={1} max={50} value={site.keepReleases} onChange={(e) => patch({ keepReleases: toInt(e.target.value, 5) })} />
      )}
    </Section>
  )
}

export const BUILD_HINT = 'Runs on the new code before it goes live. A required command failing stops the deploy and the live site stays as it was.'

export const ACTIVATE_HINT = 'Runs right after the new code is live: migrations, caches, restarting workers.'

export function CommandsSection({ draft, connectionId }: CommandsSectionProps) {
  const { site, patch } = draft
  return (
    <Section title="Commands">
      <StepsEditor
        connectionId={connectionId}
        title="Build"
        hint={BUILD_HINT}
        steps={site.buildSteps}
        onChange={(buildSteps) => patch({ buildSteps })}
      />
      <div className="border-t border-nd-border" />
      <StepsEditor
        connectionId={connectionId}
        title="After going live"
        hint={ACTIVATE_HINT}
        steps={site.activateSteps}
        onChange={(activateSteps) => patch({ activateSteps })}
      />
    </Section>
  )
}

export function SafetySection({ draft }: SectionProps) {
  const { site, patch } = draft
  return (
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
  )
}
