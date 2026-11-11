import { create } from 'zustand'

export interface RemoteSearchStatus {
  command: string | null
  server: string | null
  searchedHome: boolean
}

const IDLE: RemoteSearchStatus = { command: null, server: null, searchedHome: false }

export const useRemoteSearchStatus = create<RemoteSearchStatus>(() => IDLE)

export function setRemoteSearchStatus(status: RemoteSearchStatus): void {
  useRemoteSearchStatus.setState(status)
}

export function clearRemoteSearchStatus(): void {
  useRemoteSearchStatus.setState(IDLE)
}
