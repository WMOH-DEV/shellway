import { create } from 'zustand'

export interface RemoteSearchStatus {
  command: string | null
  server: string | null
  folder: string | null
}

const IDLE: RemoteSearchStatus = { command: null, server: null, folder: null }

export const useRemoteSearchStatus = create<RemoteSearchStatus>(() => IDLE)

export function setRemoteSearchStatus(status: Partial<RemoteSearchStatus>): void {
  useRemoteSearchStatus.setState(status)
}

export function clearRemoteSearchStatus(): void {
  useRemoteSearchStatus.setState(IDLE)
}
