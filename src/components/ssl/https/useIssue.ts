import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { IssueRequest, IssueResult } from '@/types/ssl'
import { lineageFor } from '@/utils/ssl/https/issueCommands'
import { commandRows, type CommandRow } from '@/utils/ssl/addHttps/issueView'
import { sslApi } from '../sslApi'
import { useStreamedRun, type StreamedRun } from './useStreamedRun'

export interface Issued {
  names: string[]
  lineage: string
}

export interface Issue {
  email: string
  setEmail: (email: string) => void
  redirect: boolean
  setRedirect: (redirect: boolean) => void
  staging: boolean
  setStaging: (staging: boolean) => void
  request: IssueRequest
  rows: CommandRow[] | null
  run: StreamedRun
  result: IssueResult | null
  error: string | null
  submit: () => Promise<void>
}

interface IssueTarget {
  connectionId: string
  sessionId: string
  blockId: string
  names: string[]
  onIssued: (issued: Issued) => void
}

function useRememberedEmail(sessionId: string, setEmail: Dispatch<SetStateAction<string>>): void {
  useEffect(() => {
    let active = true
    void sslApi().httpsEmail(sessionId).then(({ success, data }) => {
      if (active && success && data) setEmail((current) => current || data)
    })
    return () => { active = false }
  }, [sessionId, setEmail])
}

export function useIssue({ connectionId, sessionId, blockId, names, onIssued }: IssueTarget): Issue {
  const [email, setEmail] = useState('')
  const [redirect, setRedirect] = useState(true)
  const [staging, setStaging] = useState(true)
  const [result, setResult] = useState<IssueResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useStreamedRun()
  const request: IssueRequest = { blockId, names, email: email.trim(), redirect, staging }
  const rows = commandRows(request)
  useRememberedEmail(sessionId, setEmail)

  const submit = async () => {
    if (!rows) return
    setResult(null)
    setError(null)
    const outcome = await run.start((runId) => sslApi().httpsIssue(connectionId, sessionId, request, runId))
    setError(outcome.error)
    setResult(outcome.data)
    if (outcome.data?.ok) onIssued({ names, lineage: outcome.data.lineage ?? lineageFor(request) })
  }

  return { email, setEmail, redirect, setRedirect, staging, setStaging, request, rows, run, result, error, submit }
}
