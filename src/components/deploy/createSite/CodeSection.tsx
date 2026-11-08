import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { githubSshUrl, isHttpUrl, parseGitHubRepo } from '@/utils/deploy/githubRepo'
import { Choice, Section, SOURCE_OPTIONS, toInt } from '../setup/SiteSections'
import type { CodeSource } from '@/types/createSite'
import { NewProjectSection } from './NewProjectSection'
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

const CODE_SOURCES: { value: CodeSource; label: string; hint: string }[] = [
  { value: 'git', label: 'Use my git repository', hint: 'Shellway deploys it and reads it to suggest the stack.' },
  { value: 'new', label: 'Start a new project', hint: 'Shellway makes a starter project, puts it in a new repository and deploys it.' },
  { value: 'none', label: 'No code yet', hint: 'Only the folder with a placeholder page, the web server site, DNS and HTTPS. No deploys.' }
]

function DeploySettings({ model }: { model: CreateSiteDraftModel }) {
  const { draft, patch } = model
  const isAuto = draft.sourceMode === 'auto'
  return (
    <>
      <Choice value={draft.sourceMode} options={SOURCE_OPTIONS} onChange={(sourceMode) => patch({ sourceMode })} />
      {isAuto && !(draft.codeSource === 'new' && draft.repoKind === 'github') && isHttpUrl(draft.repoUrl) && <SshUrlWarning model={model} />}
      {isAuto && (
        <Input
          label="Check for new commits every (minutes)"
          type="number" min={1} max={60}
          value={draft.pollMinutes}
          onChange={(e) => patch({ pollMinutes: toInt(e.target.value, 1) })}
        />
      )}
    </>
  )
}

function GitRepoFields({ model }: { model: CreateSiteDraftModel }) {
  const { draft, patch } = model
  return (
    <div className="grid grid-cols-[1fr_160px] gap-3">
      <Input label="Repository" placeholder="git@github.com:owner/repo.git" value={draft.repoUrl} onChange={(e) => patch({ repoUrl: e.target.value.trim() })} />
      <Input label="Branch" value={draft.branch} onChange={(e) => patch({ branch: e.target.value.trim() })} />
    </div>
  )
}

export function CodeSection({ model }: { model: CreateSiteDraftModel }) {
  const { draft, patch } = model
  return (
    <Section title="Code">
      <Choice value={draft.codeSource} options={CODE_SOURCES} onChange={model.changeCodeSource} />
      {draft.codeSource === 'git' && <GitRepoFields model={model} />}
      {draft.codeSource === 'new' && (
        <>
          <NewProjectSection model={model} />
          <div className="grid grid-cols-[160px] gap-3">
            <Input label="Branch" value={draft.branch} onChange={(e) => patch({ branch: e.target.value.trim() })} />
          </div>
        </>
      )}
      {draft.codeSource !== 'none' && <DeploySettings model={model} />}
    </Section>
  )
}
