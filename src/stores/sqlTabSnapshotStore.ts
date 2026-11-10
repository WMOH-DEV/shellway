import { create } from 'zustand'

export interface SqlTabSnapshot {
  totalRows?: number
  filterSummary?: string
  sortSummary?: string
  sampleRows: string[]
}

const useSnapshotStore = create<Record<string, SqlTabSnapshot>>(() => ({}))

export function setSqlTabSnapshot(tabId: string, snapshot: SqlTabSnapshot): void {
  useSnapshotStore.setState({ [tabId]: { ...snapshot, sampleRows: snapshot.sampleRows.slice(0, 3) } })
}

export function clearSqlTabSnapshot(tabId: string): void {
  useSnapshotStore.setState((all) => {
    const { [tabId]: _removed, ...rest } = all
    return rest
  }, true)
}

export function useSqlTabSnapshot(tabId: string | null | undefined): SqlTabSnapshot | undefined {
  return useSnapshotStore((all) => (tabId ? all[tabId] : undefined))
}
