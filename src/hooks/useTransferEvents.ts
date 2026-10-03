import { useEffect } from 'react'
import { useTransferStore } from '@/stores/transferStore'
import type { TransferItem, TransferScan } from '@/types/transfer'

export function useTransferEvents(): void {
  useEffect(() => {
    const { upsertTransfer, applyScan } = useTransferStore.getState()
    const track = (connectionId: string, item: unknown) =>
      upsertTransfer({ ...(item as TransferItem), connectionId })

    const unsubscribers = [
      window.novadeck.sftp.onTransferUpdate(track),
      window.novadeck.sftp.onTransferComplete(track),
      window.novadeck.sftp.onTransferScan((_connectionId, scan) => applyScan(scan as TransferScan))
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [])
}
