import { useRef, useState } from 'react'
import type { ServerTools } from '@/types/createSite'
import { isIssuableName } from '@/utils/ssl/https/issueCommands'
import { folderForName, newDraft, siteNameFromDomain, type CreateSiteDraft, type NameCheckState } from '@/utils/createSite/wizard'
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
}

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

  return { draft: { ...fields, email }, nameCheck, checking, patch, setEmail, changeDomain, changeSiteName, changeFolder, checkName }
}
