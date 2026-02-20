import { create } from 'zustand'
import type { TransferItem } from '@/types/transfer'

interface TransferState {
  transfers: TransferItem[]
  setTransfers: (items: TransferItem[]) => void
  updateTransfer: (item: TransferItem) => void
  removeTransfer: (id: string) => void
  clearCompleted: () => void
}

export const useTransferStore = create<TransferState>((set) => ({
  transfers: [],

  setTransfers: (items) => set({ transfers: items }),

  updateTransfer: (item) =>
    set((state) => {
      const idx = state.transfers.findIndex((t) => t.id === item.id)
      if (idx === -1) {
        return { transfers: [...state.transfers, item] }
      }
      const updated = [...state.transfers]
      updated[idx] = item
      return { transfers: updated }
    }),

  removeTransfer: (id) =>
    set((state) => ({
      transfers: state.transfers.filter((t) => t.id !== id)
    })),

  clearCompleted: () =>
    set((state) => ({
      transfers: state.transfers.filter(
        (t) => t.status !== 'completed' && t.status !== 'cancelled'
      )
    }))
}))
