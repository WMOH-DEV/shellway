import { useState } from 'react'
import type { SwitchResult } from '@/types/ssl'
import { sslApi } from '../sslApi'
import { useStreamedRun, type StreamedRun } from '../https/useStreamedRun'
import { useMounted } from './useMounted'

export interface UndoSwitch {
  run: StreamedRun
  result: SwitchResult | null
  error: string | null
  undo: () => Promise<void>
}

export function useUndoSwitch(connectionId: string, sessionId: string, name: string, onFinished?: (result: SwitchResult | null) => void | Promise<void>): UndoSwitch {
  const [result, setResult] = useState<SwitchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useStreamedRun()
  const mounted = useMounted()

  const undo = async () => {
    setResult(null)
    setError(null)
    const outcome = await run.start((runId) => sslApi().originUndo(connectionId, sessionId, name, runId))
    if (!mounted.current) return
    setResult(outcome.data)
    setError(outcome.error)
    await onFinished?.(outcome.data)
  }

  return { run, result, error, undo }
}
