import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { StepHeading } from '@/components/ssl/https/StepHeading'
import { githubSshUrl, isHttpUrl, parseGitHubRepo } from '@/utils/deploy/githubRepo'
import { Choice, Section, SOURCE_OPTIONS, toInt } from '../setup/SiteSections'
import type { CreateSiteDraftModel } from './useCreateSiteDraft'

function SshUrlWarning({ model }: { model: CreateSiteDraftModel }) {
  const github = parseGitHubRepo(model.draft.repoUrl)
  return (
    <div className="flex items-center gap-2 rounded-md border border-nd-warning/30 bg-nd-warning/[0.07] p-2 text-2xs text-nd-text-primary">
      <AlertTriangle size={13} className="text-nd-warning-fg" />
      <span className="flex-1">Deploy keys only work with SSH repository URLs.</span>
      {github && <Button size="sm" variant="secondary" onClick={() => model.patch({ repoUrl: githubSshUrl(github) })}>Use SSH URL</Button>}
    </div>
  )
}

export function CodeStep({ model }: { model: CreateSiteDraftModel }) {
  const { draft, patch } = model
  const isAuto = draft.sourceMode === 'auto'
  return (
    <div className="flex flex-col gap-5">
      <StepHeading title="Code" subtitle="Where the site's code comes from and how new commits reach the server." />
      <Section title="Code">
        <div className="grid grid-cols-[1fr_160px] gap-3">
          <Input label="Repository" placeholder="git@github.com:owner/repo.git" value={draft.repoUrl} onChange={(e) => patch({ repoUrl: e.target.value.trim() })} />
          <Input label="Branch" value={draft.branch} onChange={(e) => patch({ branch: e.target.value.trim() })} />
        </div>
        <Choice value={draft.sourceMode} options={SOURCE_OPTIONS} onChange={(sourceMode) => patch({ sourceMode })} />
        {isAuto && isHttpUrl(draft.repoUrl) && <SshUrlWarning model={model} />}
        {isAuto && (
          <Input
            label="Check for new commits every (minutes)"
            type="number" min={1} max={60}
            value={draft.pollMinutes}
            onChange={(e) => patch({ pollMinutes: toInt(e.target.value, 1) })}
          />
        )}
      </Section>
    </div>
  )
}
