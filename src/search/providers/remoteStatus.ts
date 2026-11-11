import { create } from 'zustand'

export interface RemoteSearchStatus {
  command: string | null
  server: string | null
}

export const useRemoteSearchStatus = create<RemoteSearchStatus>(() => ({ command: null, server: null }))

export function setRemoteSearchStatus(status: RemoteSearchStatus): void {
  useRemoteSearchStatus.setState(status)
}

export function clearRemoteSearchStatus(): void {
  useRemoteSearchStatus.setState({ command: null, server: null })
}
