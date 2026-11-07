import { create } from 'zustand'
import { settle } from '@/components/server/action/settle'
import { serverApi } from '@/components/server/serverApi'
import type { ServerFacts, ServerResult } from '@/types/server/core'

interface ServerFactsState {
  byConnection: Record<string, ServerFacts>
}

export const useServerFactsStore = create<ServerFactsState>(() => ({ byConnection: {} }))

const inFlight = new Map<string, Promise<ServerResult<ServerFacts>>>()
let listening = false

export function mergeFacts(connectionId: string, facts: ServerFacts): void {
  useServerFactsStore.setState((state) => ({
    byConnection: { ...state.byConnection, [connectionId]: { ...state.byConnection[connectionId], ...facts } }
  }))
}

export function listenForFacts(): void {
  if (listening) return
  listening = true
  serverApi().onFacts(mergeFacts)
}

const scanKey = (connectionId: string, probeIds: readonly string[], force: boolean): string =>
  [connectionId, force ? 'force' : 'cached', ...[...probeIds].sort()].join('\n')

export function scanFacts(connectionId: string, probeIds: readonly string[], force: boolean): Promise<ServerResult<ServerFacts>> {
  const key = scanKey(connectionId, probeIds, force)
  const pending = inFlight.get(key)
  if (pending) return pending
  const request = settle(serverApi().scan(connectionId, [...probeIds], force))
    .then((result) => {
      if (result.success) mergeFacts(connectionId, result.data)
      return result
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, request)
  return request
}

export function pickFacts(facts: ServerFacts | undefined, probeIds: readonly string[]): ServerFacts {
  if (!facts) return {}
  return Object.fromEntries(probeIds.filter((id) => id in facts).map((id) => [id, facts[id]]))
}
