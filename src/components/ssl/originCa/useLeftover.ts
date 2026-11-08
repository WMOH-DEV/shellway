import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionResult, SwitchLeftover } from '@/types/ssl'
import { sslApi } from '../sslApi'
import { useStreamedRun, type StreamedRun } from '../https/useStreamedRun'
import { useMounted } from './useMounted'
import { useUndoSwitch, type UndoSwitch } from './useUndoSwitch'

export type LeftoverAction = 'remove' | 'undo'

export interface Leftover {
  leftover: SwitchLeftover | null
  last: LeftoverAction | null
  busy: boolean
  remove: StreamedRun
  removeResult: ActionResult | null
  removeError: string | null
  undo: UndoSwitch
  removeLineage: () => Promise<void>
}

export function useLeftover(connectionId: string, sessionId: string, name: string, enabled: boolean, onChanged: () => void | Promise<void>): Leftover {
  const [leftover, setLeftover] = useState<SwitchLeftover | null>(null)
  const [last, setLast] = useState<LeftoverAction | null>(null)
  const [removeResult, setRemoveResult] = useState<ActionResult | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const latest = useRef(0)
  const mounted = useMounted()
  const remove = useStreamedRun()

  const reload = useCallback(async () => {
    const request = ++latest.current
    if (!enabled) return setLeftover(null)
    const response = await sslApi().originLeftover(connectionId, name).catch(() => null)
    if (request !== latest.current || !mounted.current) return
    setLeftover(response?.success ? (response.data ?? null) : null)
  }, [connectionId, name, enabled, mounted])

  useEffect(() => {
    void reload()
    return () => { latest.current += 1 }
  }, [reload])

  const afterRun = async (succeeded: boolean) => {
    if (succeeded) {
      latest.current += 1
      setLeftover(null)
    }
    await onChanged()
    if (!succeeded && mounted.current) await reload()
  }

  const undo = useUndoSwitch(connectionId, sessionId, name, (result) => afterRun(result?.ok === true))

  const removeLineage = async () => {
    if (!leftover) return
    setLast('remove')
    setRemoveResult(null)
    setRemoveError(null)
    const outcome = await remove.start((runId) => sslApi().removeLineage(connectionId, leftover.lineage, runId))
    if (!mounted.current) return
    setRemoveResult(outcome.data)
    setRemoveError(outcome.error)
    await afterRun(outcome.data?.code === 0)
  }

  const startUndo = async () => {
    setLast('undo')
    await undo.undo()
  }

  return {
    leftover,
    last,
    busy: remove.running || undo.run.running,
    remove,
    removeResult,
    removeError,
    undo: { ...undo, undo: startUndo },
    removeLineage
  }
}
