import { useEffect } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Toggle } from '@/components/ui/Toggle'
import { GithubTokenForm } from '@/components/server/sections/settings/AccountCards'
import type { NewRepo } from '@/types/createSite'
import { localProjectPath } from '@/utils/createSite/scaffold'
import { projectCheckKey, repoNameOf } from '@/utils/createSite/wizard'
import { Choice } from '../setup/SiteSections'
import type { CreateSiteDraftModel } from './useCreateSiteDraft'

const REPO_KINDS: { value: NewRepo['kind']; label: string; hint: string }[] = [
  { value: 'github', label: 'Create a new GitHub repository', hint: 'Made with your saved GitHub token. Private unless you say otherwise.' },
  { value: 'empty', label: 'Use an empty repository I made', hint: 'Any git host. It must have no commits yet.' }
]

const CHECK_DELAY_MS = 400

function GithubAccount({ model }: { model: CreateSiteDraftModel }) {
  const { github, loadGithub } = model
  if (github.status === 'idle' || github.status === 'loading') return <span className="text-2xs text-nd-text-muted">Checking your GitHub login…</span>
  if (github.status === 'failed') {
    return (
      <div className="flex items-center gap-2 text-2xs text-nd-error-fg">
        <span className="min-w-0 truncate" title={github.error}>{github.error}</span>
        <Button size="sm" variant="ghost" onClick={() => void loadGithub()}>Try again</Button>
      </div>
    )
  }
  if (github.status === 'missing') {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-2xs text-nd-text-muted">No GitHub token is saved. Add one that can create repositories (the repo scope, or Administration write for a fine-grained token).</span>
        <GithubTokenForm onSaved={() => void loadGithub()} />
      </div>
    )
  }
  return null
}

function GithubRepoFields({ model }: { model: CreateSiteDraftModel }) {
  const { draft, patch, github } = model
  const owner = github.status === 'ready' ? github.login : 'you'
  return (
    <div className="flex flex-col gap-2">
      <GithubAccount model={model} />
      {github.status === 'ready' && (
        <>
          <Input label={`Repository name, under github.com/${owner}`} placeholder={draft.siteName} spellCheck={false} value={draft.repoName} onChange={(e) => patch({ repoName: e.target.value.trim() })} />
          <Toggle checked={draft.repoPrivate} onChange={(repoPrivate) => patch({ repoPrivate })} label="Private repository" />
          <span className="text-2xs text-nd-text-muted">Creates github.com/{owner}/{repoNameOf(draft)}. Shellway never deletes it.</span>
        </>
      )}
    </div>
  )
}

function LocalFolder({ model }: { model: CreateSiteDraftModel }) {
  const { draft, patch } = model
  const choose = async () => {
    const result = await window.novadeck.dialog.openFile({ title: 'Where should the new project go?', properties: ['openDirectory', 'createDirectory'] })
    if (!result.canceled && result.filePaths[0]) patch({ localParent: result.filePaths[0] })
  }
  const target = draft.localParent.trim() !== '' && draft.siteName !== '' ? localProjectPath(draft.localParent.trim(), draft.siteName) : null
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input label="Folder on this PC" placeholder="/Users/you/Projects" spellCheck={false} value={draft.localParent} onChange={(e) => patch({ localParent: e.target.value })} />
        </div>
        <Button onClick={() => void choose()}><FolderOpen size={13} /> Choose…</Button>
      </div>
      {target && <span className="text-2xs text-nd-text-muted">The project is made in {target}, committed there and pushed with your own git login. You keep working in it.</span>}
    </div>
  )
}

function ProjectCheckNote({ model }: { model: CreateSiteDraftModel }) {
  const { projectCheck, draft } = model
  if (projectCheck === null || projectCheck.key !== projectCheckKey(draft) || projectCheck.problem === null) return null
  return (
    <div>
      <Button size="sm" variant="ghost" onClick={() => void model.checkProject(true)}>Check the repository and folder again</Button>
    </div>
  )
}

function useProjectCheck(model: CreateSiteDraftModel) {
  const { draft, checkProject } = model
  const key = projectCheckKey(draft)
  const ready = draft.localParent.trim() !== '' && draft.siteName !== '' && (draft.repoKind === 'empty' ? draft.repoUrl !== '' : draft.githubOwner !== '')
  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => void checkProject(), CHECK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [key, ready])
}

export function NewProjectSection({ model }: { model: CreateSiteDraftModel }) {
  const { draft, patch, github, loadGithub } = model
  useProjectCheck(model)
  useEffect(() => {
    if (draft.repoKind === 'github' && github.status === 'idle') void loadGithub()
  }, [draft.repoKind])
  return (
    <div className="flex flex-col gap-3">
      <Choice value={draft.repoKind} options={REPO_KINDS} onChange={(repoKind) => patch({ repoKind })} />
      {draft.repoKind === 'github' ? (
        <GithubRepoFields model={model} />
      ) : (
        <Input label="Empty repository" placeholder="git@github.com:owner/repo.git" spellCheck={false} value={draft.repoUrl} onChange={(e) => patch({ repoUrl: e.target.value.trim() })} />
      )}
      <LocalFolder model={model} />
      <ProjectCheckNote model={model} />
    </div>
  )
}
