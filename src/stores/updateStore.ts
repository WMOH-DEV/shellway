import { create } from 'zustand'

/** Auto-update lifecycle status */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error'
  | 'up-to-date'

/** Download progress info from electron-updater */
export interface DownloadProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

interface UpdateState {
  status: UpdateStatus
  version: string
  progress: DownloadProgress | null
  errorMessage: string | null

  // Actions
  setChecking: () => void
  setAvailable: (version: string) => void
  setNotAvailable: () => void
  setDownloadProgress: (progress: DownloadProgress) => void
  setReady: (version: string) => void
  setError: (message: string) => void
  dismiss: () => void
}

export const useUpdateStore = create<UpdateState>((set) => ({
  status: 'idle',
  version: '',
  progress: null,
  errorMessage: null,

  setChecking: () =>
    set({ status: 'checking', version: '', progress: null, errorMessage: null }),

  setAvailable: (version) =>
    set({ status: 'available', version, progress: null, errorMessage: null }),

  setNotAvailable: () =>
    set({ status: 'up-to-date', progress: null, errorMessage: null }),

  setDownloadProgress: (progress) =>
    set((s) => ({ status: 'downloading', progress, version: s.version })),

  setReady: (version) =>
    set({ status: 'ready', version, progress: null, errorMessage: null }),

  setError: (message) =>
    set((s) =>
      // Don't override 'ready' state — the update is already downloaded
      s.status === 'ready' ? s : { status: 'error', errorMessage: message, progress: null }
    ),

  dismiss: () =>
    set({ status: 'idle', version: '', progress: null, errorMessage: null }),
}))
