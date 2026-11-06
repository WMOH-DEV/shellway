import { create } from 'zustand'

interface HttpsIntentState {
  pending: Record<string, string>
  request: (connectionId: string, blockId: string) => void
  consume: (connectionId: string) => void
}

export const useHttpsIntentStore = create<HttpsIntentState>((set) => ({
  pending: {},
  request: (connectionId, blockId) => set((state) => ({ pending: { ...state.pending, [connectionId]: blockId } })),
  consume: (connectionId) =>
    set((state) => {
      const { [connectionId]: _taken, ...rest } = state.pending
      return { pending: rest }
    })
}))
