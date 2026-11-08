import { useCallback, useEffect, useRef, useState } from 'react'
import type { ServiceLogEntry } from '@/types/serviceManager'
import type { LogEnd, LogSource } from '@/utils/server/services/logChannel'
import { capLines, guessPriority, splitChunk } from '@/utils/server/services/logLines'
import { logSourceKey } from '@/utils/server/services/logSources'
import { serverApi } from '../../serverApi'
import type { ServerSectionContext } from '../types'

export const INITIAL_LINES = 100

export interface LogStream {
  entries: ServiceLogEntry[]
  loading: boolean
  error: string | null
  missing: boolean
  live: boolean
  ended: LogEnd | null
  load(lines: number): Promise<void>
  startLive(): Promise<void>
  stopLive(): void
}

function toEntries(lines: string[], source: LogSource): ServiceLogEntry[] {
  const errorsOnly = source.kind === 'system' && source.id === 'journal-errors'
  return lines.map((line) => ({ timestamp: '', priority: errorsOnly ? 'err' : guessPriority(line), message: line }))
}

export function useLogStream(ctx: Pick<ServerSectionContext, 'connectionId' | 'tabId'>, source: LogSource): LogStream {
  const [entries, setEntries] = useState<ServiceLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [live, setLive] = useState(false)
  const [ended, setEnded] = useState<LogEnd | null>(null)
  const followId = useRef<string | null>(null)
  const partial = useRef('')
  const sourceRef = useRef(source)
  sourceRef.current = source
  const key = logSourceKey(source)

  const stopLive = useCallback(() => {
    if (followId.current) void serverApi().services.stopLog(followId.current)
    followId.current = null
    setLive(false)
  }, [])

  const load = useCallback(async (lines: number) => {
    const requested = sourceRef.current
    setLoading(true)
    const result = await serverApi().services.readLog(ctx.connectionId, requested, lines)
    if (logSourceKey(sourceRef.current) !== logSourceKey(requested)) return
    setLoading(false)
    if (!result.success) return setError(result.error)
    setError(null)
    setMissing(result.data.missing)
    setEntries(toEntries(result.data.lines, sourceRef.current))
  }, [ctx.connectionId])

  const startLive = useCallback(async () => {
    setEnded(null)
    partial.current = ''
    const result = await serverApi().services.followLog(ctx.connectionId, ctx.tabId, sourceRef.current)
    if (!result.success) return setError(result.error)
    followId.current = result.data.followId
    setLive(true)
  }, [ctx.connectionId, ctx.tabId])

  useEffect(() => serverApi().services.onLogChunk((id, chunk) => {
    if (id !== followId.current) return
    const split = splitChunk(partial.current, chunk)
    partial.current = split.partial
    if (split.complete.length > 0) setEntries((previous) => capLines([...previous, ...toEntries(split.complete, sourceRef.current)]))
  }), [])

  useEffect(() => serverApi().services.onLogEnd((id, end) => {
    if (id !== followId.current) return
    followId.current = null
    setLive(false)
    if (end.reason === 'missing') setMissing(true)
    else if (end.reason !== 'stopped') setEnded(end)
  }), [])

  useEffect(() => {
    setEntries([])
    setEnded(null)
    void load(INITIAL_LINES)
    return stopLive
  }, [key, load, stopLive])

  return { entries, loading, error, missing, live, ended, load, startLive, stopLive }
}
