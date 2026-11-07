import { useCallback, useEffect, useState } from 'react'
import type { GuardPreview, GuardRequest, GuardRun, SecuritySessionInfo } from '@/utils/server/security/guard'
import { serverApi } from '../../serverApi'
import type { ServerSectionContext } from '../types'

export type GuardState =
  | { phase: 'idle' }
  | { phase: 'loading'; request: GuardRequest }
  | { phase: 'confirm'; request: GuardRequest; preview: GuardPreview }
  | { phase: 'error'; request: GuardRequest; message: string }
  | { phase: 'running'; run: GuardRun | null }

export interface GuardController {
  state: GuardState
  start(request: GuardRequest): void
  confirm(): void
  close(): void
}

const isLive = (run: GuardRun | null): boolean => run === null || run.outcome === 'running' || run.outcome === 'reverting'

export function useGuard(ctx: ServerSectionContext, onSettled: () => void): GuardController {
  const [state, setState] = useState<GuardState>({ phase: 'idle' })
  const [runId, setRunId] = useState<string | null>(null)

  useEffect(() => serverApi().security.onGuard((run) => {
    if (run.connectionId !== ctx.connectionId) return
    setState((previous) => (previous.phase === 'running' && (runId === null || run.id === runId) ? { phase: 'running', run } : previous))
    if (!isLive(run)) onSettled()
  }), [ctx.connectionId, runId, onSettled])

  useEffect(() => {
    if (!ctx.active) return
    void serverApi().security.current(ctx.connectionId).then((result) => {
      if (result.success && result.data && isLive(result.data)) {
        setRunId(result.data.id)
        setState({ phase: 'running', run: result.data })
      }
    })
  }, [ctx.active, ctx.connectionId])

  const start = useCallback((request: GuardRequest) => {
    setState({ phase: 'loading', request })
    void serverApi().security.preview(ctx.connectionId, request).then((result) => {
      setState(result.success ? { phase: 'confirm', request, preview: result.data } : { phase: 'error', request, message: result.error })
    })
  }, [ctx.connectionId])

  const confirm = useCallback(() => {
    if (state.phase !== 'confirm') return
    const { request } = state
    setRunId(null)
    setState({ phase: 'running', run: null })
    void serverApi().security.run(ctx.connectionId, ctx.sessionId, request).then((result) => {
      if (result.success) setRunId(result.data.runId)
      else setState({ phase: 'error', request, message: result.error })
    })
  }, [ctx.connectionId, ctx.sessionId, state])

  const close = useCallback(() => {
    setState((previous) => (previous.phase === 'running' && isLive(previous.run) ? previous : { phase: 'idle' }))
  }, [])

  return { state, start, confirm, close }
}

export function useSecuritySession(ctx: ServerSectionContext): SecuritySessionInfo | null {
  const [info, setInfo] = useState<SecuritySessionInfo | null>(null)
  useEffect(() => {
    if (!ctx.active || ctx.connectionStatus !== 'connected') return
    void serverApi().security.session(ctx.connectionId).then((result) => setInfo(result.success ? result.data : null))
  }, [ctx.active, ctx.connectionId, ctx.connectionStatus])
  return info
}
