import { create } from 'zustand'

interface HttpsIntentState {
  pending: Record<string, string>
  deployReturns: Record<string, true>
  request: (connectionId: string, blockId: string) => void
  consume: (connectionId: string) => void
  requestDeploy: (connectionId: string) => void
  consumeDeploy: (connectionId: string) => void
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _taken, ...rest } = record
  return rest
}

export const useHttpsIntentStore = create<HttpsIntentState>((set) => ({
  pending: {},
  deployReturns: {},
  request: (connectionId, blockId) => set((state) => ({ pending: { ...state.pending, [connectionId]: blockId } })),
  consume: (connectionId) => set((state) => ({ pending: without(state.pending, connectionId) })),
  requestDeploy: (connectionId) => set((state) => ({ deployReturns: { ...state.deployReturns, [connectionId]: true } })),
  consumeDeploy: (connectionId) => set((state) => ({ deployReturns: without(state.deployReturns, connectionId) }))
}))
