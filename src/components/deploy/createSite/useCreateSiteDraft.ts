import { useRef, useState } from 'react'
import type { CodeSource, ServerTools, TemplateId } from '@/types/createSite'
import { defaultDatabase } from '@/utils/createSite/database'
import { suggestStack, type StackSuggestion } from '@/utils/createSite/repoSuggest'
import { isIssuableName } from '@/utils/ssl/https/issueCommands'
import {
  allowedTemplates,
  folderForName,
  newDraft,
  projectCheckKey,
  projectCheckRequest,
  siteNameFromDomain,
  suggestedDraft,
  type CreateSiteDraft,
  type NameCheckState,
  type ProjectCheckState
} from '@/utils/createSite/wizard'
import { useRememberedEmail } from '@/components/ssl/https/useIssue'
import { createSiteApi } from './createSiteApi'

type DraftFields = Omit<CreateSiteDraft, 'email'>

export interface CreateSiteDraftModel {
  draft: CreateSiteDraft
  nameCheck: NameCheckState | null
  checking: boolean
  patch: (changes: Partial<DraftFields>) => void
  setEmail: (email: string) => void
  changeDomain: (domain: string) => void
  changeSiteName: (siteName: string) => void
  changeFolder: (folder: string) => void
  checkName: () => Promise<void>
  repoRead: RepoRead | null
  readRepo: () => Promise<void>
  pickTemplate: (template: TemplateId) => void
  applySuggestion: (suggestion: StackSuggestion) => void
  github: GithubState
  loadGithub: () => Promise<void>
  projectCheck: ProjectCheckState | null
  checkProject: (again?: boolean) => Promise<void>
  changeCodeSource: (source: CodeSource) => void
}

export type GithubState =
  | { status: 'idle' | 'loading' | 'missing' }
  | { status: 'ready'; login: string }
  | { status: 'failed'; error: string }

export type RepoRead =
  | { key: string; status: 'reading' }
  | { key: string; status: 'read'; suggestion: StackSuggestion }
  | { key: string; status: 'failed'; error: string }

const repoKey = ({ repoUrl, branch }: Pick<CreateSiteDraft, 'repoUrl' | 'branch'>): string => `${repoUrl}\n${branch}`

const autoFolder = (siteName: string): string => (siteName === '' ? '' : folderForName(siteName))

export type CreateSitePrefill = Partial<Pick<CreateSiteDraft, 'domain' | 'template' | 'appPort'>>

function prefilledDraft(tools: ServerTools, prefill: CreateSitePrefill): DraftFields {
  const draft = { ...newDraft(tools), ...prefill }
  const siteName = draft.domain ? siteNameFromDomain(draft.domain) : draft.siteName
  return { ...draft, siteName, folder: autoFolder(siteName) }
}

export function useCreateSiteDraft(connectionId: string, sessionId: string, tools: ServerTools, prefill: CreateSitePrefill = {}): CreateSiteDraftModel {
  const [fields, setFields] = useState<DraftFields>(() => prefilledDraft(tools, prefill))
  const [email, setEmail] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [folderEdited, setFolderEdited] = useState(false)
  const [nameCheck, setNameCheck] = useState<NameCheckState | null>(null)
  const [checking, setChecking] = useState(false)
  const latestCheck = useRef(0)
  const [repoRead, setRepoRead] = useState<RepoRead | null>(null)
  const latestRepo = useRef('')
  const templatePicked = useRef(prefill.template !== undefined)
  const [github, setGithub] = useState<GithubState>({ status: 'idle' })
  const [projectCheck, setProjectCheck] = useState<ProjectCheckState | null>(null)
  const latestProject = useRef('')
  useRememberedEmail(sessionId, setEmail)

  const patch = (changes: Partial<DraftFields>) => setFields((current) => ({ ...current, ...changes }))

  const changeDomain = (raw: string) => {
    const domain = raw.trim().toLowerCase()
    const siteName = nameEdited ? fields.siteName : siteNameFromDomain(domain)
    patch({ domain, siteName, folder: folderEdited ? fields.folder : autoFolder(siteName) })
  }

  const changeSiteName = (siteName: string) => {
    setNameEdited(true)
    patch({ siteName, folder: folderEdited ? fields.folder : autoFolder(siteName) })
  }

  const changeFolder = (folder: string) => {
    setFolderEdited(true)
    patch({ folder: folder.trim() })
  }

  const checkName = async () => {
    const { domain } = fields
    if (!isIssuableName(domain) || (nameCheck?.domain === domain && nameCheck.error === null)) return
    const request = ++latestCheck.current
    setChecking(true)
    const result = await createSiteApi().checkName(connectionId, domain)
    if (request !== latestCheck.current) return
    setChecking(false)
    setNameCheck(result.success && result.data
      ? { domain, result: result.data, error: null }
      : { domain, result: null, error: result.error ?? `Could not check ${domain}` })
  }

  const applySuggestion = (suggestion: StackSuggestion) => setFields((current) => ({ ...current, ...suggestedDraft({ ...current, email }, suggestion, tools) }))

  const readRepo = async () => {
    const key = repoKey(fields)
    if (repoRead?.key === key && repoRead.status !== 'failed') return
    latestRepo.current = key
    setRepoRead({ key, status: 'reading' })
    const result = await createSiteApi().inspectRepo(fields.repoUrl, fields.branch)
    if (latestRepo.current !== key) return
    if (!result.success || !result.data) {
      setRepoRead({ key, status: 'failed', error: result.error ?? 'Could not read the repository' })
      return
    }
    const suggestion = suggestStack(result.data)
    setRepoRead({ key, status: 'read', suggestion })
    if (!templatePicked.current) applySuggestion(suggestion)
  }

  const pickTemplate = (template: TemplateId) => {
    templatePicked.current = true
    patch({ template, commands: null, database: defaultDatabase(template, tools) })
  }

  const loadGithub = async () => {
    setGithub({ status: 'loading' })
    const result = await createSiteApi().githubAccount()
    if (!result.success) {
      setGithub({ status: 'failed', error: result.error ?? 'Could not reach GitHub' })
      return
    }
    const login = result.data ?? null
    setGithub(login === null ? { status: 'missing' } : { status: 'ready', login })
    patch({ githubOwner: login ?? '' })
  }

  const checkProject = async (again = false) => {
    const draft = { ...fields, email }
    const key = projectCheckKey(draft)
    if (!again && (projectCheck?.key === key || latestProject.current === key)) return
    setProjectCheck(null)
    latestProject.current = key
    const result = await createSiteApi().checkProject(projectCheckRequest(draft))
    if (latestProject.current !== key) return
    setProjectCheck({ key, problem: result.success ? result.data ?? null : result.error ?? 'Could not check the new project' })
  }

  const changeCodeSource = (codeSource: CodeSource) => {
    const allowed = allowedTemplates(codeSource)
    const template = allowed.includes(fields.template) ? fields.template : allowed[0]
    patch({ codeSource, template, ...(template === fields.template ? {} : { commands: null, database: defaultDatabase(template, tools) }) })
  }

  return {
    draft: { ...fields, email },
    nameCheck,
    checking,
    patch,
    setEmail,
    changeDomain,
    changeSiteName,
    changeFolder,
    checkName,
    repoRead,
    readRepo,
    pickTemplate,
    applySuggestion,
    github,
    loadGithub,
    projectCheck,
    checkProject,
    changeCodeSource
  }
}
