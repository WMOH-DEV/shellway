import { useEffect, useRef, useState } from 'react'
import type { CreateSiteInput, CreateSiteSecrets, ResumeMode, RunRecord } from '@/types/createSite'
import type { DeployResult } from '@/types/deploy'
import { createSiteApi } from './createSiteApi'

export interface CreateRun {
  record: RunRecord | null
  output: string
  busy: boolean
  stopRequested: boolean
  error: string | null
  start: (input: CreateSiteInput, secrets: CreateSiteSecrets) => Promise<void>
  stop: () => Promise<void>
  resume: (mode: ResumeMode) => Promise<void>
  remove: () => Promise<void>
}

function useRunEvents(initial: RunRecord | null) {
  const [record, setRecord] = useState(initial)
  const [output, setOutput] = useState('')
  const runId = useRef(initial?.id ?? null)
  const earlyOutput = useRef(new Map<string, string>())
  const earlyUpdates = useRef(new Map<string, RunRecord>())

  useEffect(() => {
    const api = createSiteApi()
    const offUpdate = api.onUpdate((next) => {
      if (runId.current === null) earlyUpdates.current.set(next.id, next)
      else if (next.id === runId.current) setRecord(next)
    })
    const offOutput = api.onOutput(({ runId: id, chunk }) => {
      if (runId.current === null) earlyOutput.current.set(id, (earlyOutput.current.get(id) ?? '') + chunk)
      else if (id === runId.current) setOutput((current) => current + chunk)
    })
    return () => {
      offUpdate()
      offOutput()
    }
  }, [])

  const follow = (started: RunRecord) => {
    runId.current = started.id
    setOutput(earlyOutput.current.get(started.id) ?? '')
    setRecord(earlyUpdates.current.get(started.id) ?? started)
    earlyOutput.current.clear()
    earlyUpdates.current.clear()
  }

  return { record, setRecord, output, follow }
}

export function useCreateRun(connectionId: string, sessionId: string, initial: RunRecord | null): CreateRun {
  const { record, setRecord, output, follow } = useRunEvents(initial)
  const [busy, setBusy] = useState(false)
  const [stopRequested, setStopRequested] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const call = async <T,>(task: () => Promise<DeployResult<T>>, failure: string): Promise<DeployResult<T>> => {
    setBusy(true)
    setError(null)
    const result = await task().catch((err: Error): DeployResult<T> => ({ success: false, error: err.message }))
    setBusy(false)
    if (!result.success) setError(result.error ?? failure)
    return result
  }

  const replaceRecord = async (task: () => Promise<DeployResult<RunRecord>>, failure: string) => {
    const result = await call(task, failure)
    if (result.success && result.data) setRecord(result.data)
  }

  const start = async (input: CreateSiteInput, secrets: CreateSiteSecrets) => {
    const result = await call(() => createSiteApi().start(connectionId, sessionId, input, secrets), 'The run could not start')
    if (result.success && result.data) follow(result.data)
  }

  const stop = async () => {
    if (!record) return
    const result = await call(() => createSiteApi().stop(record.id), 'Could not stop the run')
    if (result.success) setStopRequested(true)
  }

  const resume = async (mode: ResumeMode) => {
    if (!record) return
    setStopRequested(false)
    await replaceRecord(() => createSiteApi().resume(connectionId, record.id, mode), 'Could not resume the run')
  }

  const remove = async () => {
    if (!record) return
    await replaceRecord(() => createSiteApi().remove(connectionId, record.id), 'Could not remove what this run created')
  }

  return { record, output, busy, stopRequested: stopRequested && record?.phase === 'running', error, start, stop, resume, remove }
}
