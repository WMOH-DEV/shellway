import { useCallback, useEffect, useMemo, useState } from 'react'
import { deployApi } from '@/components/deploy/useDeploySites'
import type { NameReadiness, ServerBlock, SslReport, SslResult } from '@/types/ssl'
import { issuableNames, nameChoices, selectedNames, type NameChoice } from '@/utils/ssl/addHttps/names'
import { blockForHostname } from '@/utils/ssl/https/siteMatch'
import { siteOptions, type DeploySiteRef, type SiteOption } from '@/utils/ssl/addHttps/siteOptions'
import { sslApi } from '../sslApi'
import { useSslResource, type SslResource } from '../settings/useSslResource'

export const OTHER_SITE = 'other'

export interface SiteSelection {
  options: SiteOption[]
  choice: string | null
  choose: (id: string) => void
  otherText: string
  setOtherText: (text: string) => void
  otherError: string | null
  block: ServerBlock | null
  title: string | null
  choices: NameChoice[]
  readiness: SslResource<NameReadiness[]>
  selected: string[]
  toggle: (name: string) => void
}

const NO_NAMES: SslResult<NameReadiness[]> = { success: true, data: [] }

function useDeploySites(connectionId: string, sessionId: string): DeploySiteRef[] {
  const load = useCallback(() => deployApi().list(connectionId, sessionId), [connectionId, sessionId])
  const { data } = useSslResource(load)
  return useMemo(() => (data ?? []).map(({ config }) => ({ name: config.name, path: config.path, healthUrl: config.healthUrl })), [data])
}

function useReadiness(connectionId: string, sessionId: string, names: string[]): SslResource<NameReadiness[]> {
  const key = names.join(',')
  const load = useCallback(
    () => (key === '' ? Promise.resolve(NO_NAMES) : sslApi().httpsReadiness(connectionId, sessionId, key.split(','))),
    [connectionId, sessionId, key]
  )
  return useSslResource(load)
}

export function useSiteSelection(connectionId: string, sessionId: string, report: SslReport, initialBlockId: string | null): SiteSelection {
  const [choice, setChoice] = useState<string | null>(initialBlockId)
  const [otherText, setOtherText] = useState('')
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set())
  const sites = useDeploySites(connectionId, sessionId)
  const options = useMemo(() => siteOptions(sites, report.blocks, initialBlockId), [sites, report.blocks, initialBlockId])
  const picked = options.find((option) => option.id === choice)
  const block = choice === OTHER_SITE ? blockForHostname(otherText, report.blocks) : picked?.block ?? null
  const choices = useMemo(() => (block ? nameChoices(block) : []), [block])
  const issuable = useMemo(() => issuableNames(choices), [choices])
  const readiness = useReadiness(connectionId, sessionId, issuable)
  const selected = selectedNames(choices, readiness.data ?? [], unticked)
  const typed = otherText.trim()

  useEffect(() => setUnticked(new Set()), [block?.id])

  const toggle = (name: string) =>
    setUnticked((current) => {
      const next = new Set(current)
      if (!next.delete(name)) next.add(name)
      return next
    })

  return {
    options,
    choice,
    choose: setChoice,
    otherText,
    setOtherText,
    otherError: choice === OTHER_SITE && typed !== '' && !block ? `No nginx server block names ${typed}` : null,
    block,
    title: choice === OTHER_SITE ? block?.names[0] ?? null : picked?.title ?? null,
    choices,
    readiness,
    selected,
    toggle
  }
}
