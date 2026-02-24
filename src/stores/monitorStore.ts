import { create } from 'zustand'
import type { MonitorSnapshot, MonitorStatus } from '@/types/monitor'

interface MonitorState {
  /** Latest snapshot per connection */
  snapshots: Map<string, MonitorSnapshot>
  /** Full history per connection (for charts) */
  history: Map<string, MonitorSnapshot[]>
  /** Monitor status per connection */
  status: Map<string, MonitorStatus>
  /** Error messages per connection */
  errors: Map<string, string | null>

  /** Update with new snapshot data */
  pushSnapshot: (connectionId: string, snapshot: MonitorSnapshot) => void
  /** Set full history (on tab mount, fetch from main) */
  setHistory: (connectionId: string, history: MonitorSnapshot[]) => void
  /** Update monitor status */
  setStatus: (connectionId: string, status: MonitorStatus) => void
  /** Set error message */
  setError: (connectionId: string, error: string | null) => void
  /** Clear all data for a connection */
  clearConnection: (connectionId: string) => void
}

const HISTORY_MAX = 300

export const useMonitorStore = create<MonitorState>((set) => ({
  snapshots: new Map(),
  history: new Map(),
  status: new Map(),
  errors: new Map(),

  pushSnapshot: (connectionId, snapshot) =>
    set((state) => {
      const newSnapshots = new Map(state.snapshots)
      newSnapshots.set(connectionId, snapshot)

      const newHistory = new Map(state.history)
      const existing = newHistory.get(connectionId) || []
      const updated = [...existing, snapshot]
      if (updated.length > HISTORY_MAX) updated.shift()
      newHistory.set(connectionId, updated)

      return { snapshots: newSnapshots, history: newHistory }
    }),

  setHistory: (connectionId, history) =>
    set((state) => {
      const newHistory = new Map(state.history)
      newHistory.set(connectionId, history)

      const newSnapshots = new Map(state.snapshots)
      if (history.length > 0) {
        newSnapshots.set(connectionId, history[history.length - 1])
      }

      return { snapshots: newSnapshots, history: newHistory }
    }),

  setStatus: (connectionId, status) =>
    set((state) => {
      const newStatus = new Map(state.status)
      newStatus.set(connectionId, status)
      return { status: newStatus }
    }),

  setError: (connectionId, error) =>
    set((state) => {
      const newErrors = new Map(state.errors)
      newErrors.set(connectionId, error)
      return { errors: newErrors }
    }),

  clearConnection: (connectionId) =>
    set((state) => {
      const newSnapshots = new Map(state.snapshots)
      const newHistory = new Map(state.history)
      const newStatus = new Map(state.status)
      const newErrors = new Map(state.errors)

      newSnapshots.delete(connectionId)
      newHistory.delete(connectionId)
      newStatus.delete(connectionId)
      newErrors.delete(connectionId)

      return {
        snapshots: newSnapshots,
        history: newHistory,
        status: newStatus,
        errors: newErrors
      }
    })
}))
