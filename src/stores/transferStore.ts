import { create } from 'zustand'
import type { TrackedTransfer, TransferScan } from '@/types/transfer'
import { isPending } from '@/utils/transferSummary'

interface TransferState {
  transfers: TrackedTransfer[]
  scans: TransferScan[]
  batchIds: Set<string>
  upsertTransfer: (item: TrackedTransfer) => void
  applyScan: (scan: TransferScan) => void
  clearCompleted: () => void
}

function isIdle(state: TransferState): boolean {
  return state.scans.length === 0 && !state.transfers.some(isPending)
}

export const useTransferStore = create<TransferState>((set) => ({
  transfers: [],
  scans: [],
  batchIds: new Set(),

  upsertTransfer: (item) =>
    set((state) => {
      const idx = state.transfers.findIndex((t) => t.id === item.id)
      if (idx !== -1) {
        const transfers = [...state.transfers]
        transfers[idx] = item
        return { transfers }
      }
      const batchIds = new Set(isIdle(state) ? [] : state.batchIds)
      batchIds.add(item.id)
      return { transfers: [...state.transfers, item], batchIds }
    }),

  applyScan: (scan) =>
    set((state) => {
      const others = state.scans.filter((s) => s.groupId !== scan.groupId)
      if (!scan.scanning) return { scans: others }
      const batchIds = isIdle(state) ? new Set<string>() : state.batchIds
      return { scans: [...others, scan], batchIds }
    }),

  clearCompleted: () =>
    set((state) => ({
      transfers: state.transfers.filter(
        (t) => t.status !== 'completed' && t.status !== 'cancelled'
      )
    }))
}))
