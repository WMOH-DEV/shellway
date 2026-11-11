import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSessionStore } from '@/stores/sessionStore'
import type { PortForwardRule, Session } from '@/types/session'
import type { PortForwardEntry } from '@/types/portForward'
import { specOf } from './portForwardRules'

const TRAFFIC_REFRESH_MS = 2000
const NO_RULES: PortForwardRule[] = []

export interface StartFailure {
  rule: PortForwardRule
  error: string
}

async function saveRules(sessionId: string, change: (rules: PortForwardRule[]) => PortForwardRule[]): Promise<void> {
  const saved = (await window.novadeck.sessions.getById(sessionId)) as Session | undefined
  const portForwardings = change(saved?.portForwardings ?? [])
  await window.novadeck.sessions.update(sessionId, { portForwardings })
  useSessionStore.getState().updateSession(sessionId, { portForwardings })
}

export function usePortForwards(connectionId: string, sessionId: string, connected: boolean) {
  const rules = useSessionStore((s) => s.sessions.find((session) => session.id === sessionId)?.portForwardings ?? NO_RULES)
  const [entries, setEntries] = useState<Map<string, PortForwardEntry>>(new Map())

  const refresh = useCallback(async () => {
    const list = await window.novadeck.portforward.list(connectionId)
    setEntries(new Map(list.map((entry) => [entry.id, entry])))
  }, [connectionId])

  useEffect(() => {
    void refresh()
    return window.novadeck.portforward.onChanged((changedId) => {
      if (changedId === connectionId) void refresh()
    })
  }, [connectionId, connected, refresh])

  const anyActive = useMemo(() => rules.some((rule) => entries.get(rule.id)?.status === 'active'), [rules, entries])
  useEffect(() => {
    if (!anyActive) return
    const timer = setInterval(() => void refresh(), TRAFFIC_REFRESH_MS)
    return () => clearInterval(timer)
  }, [anyActive, refresh])

  const start = useCallback(
    async (targets: PortForwardRule[]): Promise<StartFailure[]> => {
      const results = await Promise.all(
        targets.map(async (rule) => {
          const result = await window.novadeck.portforward.add(connectionId, specOf(rule))
          return result.success ? null : { rule, error: result.error ?? 'Could not start' }
        })
      )
      await refresh()
      return results.filter((failure): failure is StartFailure => failure !== null)
    },
    [connectionId, refresh]
  )

  const stop = useCallback(
    async (ids: string[]) => {
      await Promise.all(ids.map((id) => window.novadeck.portforward.remove(connectionId, id)))
      await refresh()
    },
    [connectionId, refresh]
  )

  const saveRule = useCallback(
    async (rule: PortForwardRule): Promise<StartFailure[]> => {
      await saveRules(sessionId, (current) =>
        current.some((existing) => existing.id === rule.id)
          ? current.map((existing) => (existing.id === rule.id ? rule : existing))
          : [...current, rule]
      )
      if (!entries.has(rule.id)) return []
      if (connected) return start([rule])
      await stop([rule.id])
      return []
    },
    [sessionId, entries, connected, start]
  )

  const deleteRules = useCallback(
    async (ids: string[]) => {
      await stop(ids)
      const removed = new Set(ids)
      await saveRules(sessionId, (current) => current.filter((rule) => !removed.has(rule.id)))
    },
    [sessionId, stop]
  )

  return { rules, entries, start, stop, saveRule, deleteRules }
}
