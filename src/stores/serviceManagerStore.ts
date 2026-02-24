import { create } from 'zustand'
import type {
  SystemdService,
  ServiceDetails,
  ServiceLogEntry,
  ServiceManagerStatus,
  ServiceFilter
} from '@/types/serviceManager'

const DEFAULT_FILTER: ServiceFilter = {
  search: '',
  activeFilter: 'all',
  loadFilter: 'all',
  sortBy: 'name',
  sortDir: 'asc'
}

interface ServiceManagerState {
  /** Service list per connection */
  services: Map<string, SystemdService[]>
  /** Selected service details per connection */
  details: Map<string, ServiceDetails | null>
  /** Journal logs per connection */
  logs: Map<string, ServiceLogEntry[]>
  /** Manager status per connection */
  status: Map<string, ServiceManagerStatus>
  /** Error messages per connection */
  errors: Map<string, string | null>
  /** Currently selected unit per connection */
  selectedUnit: Map<string, string | null>
  /** Filter/sort state per connection */
  filter: Map<string, ServiceFilter>

  /** Set the full service list for a connection */
  setServices: (connectionId: string, services: SystemdService[]) => void
  /** Set service details for a connection */
  setDetails: (connectionId: string, details: ServiceDetails | null) => void
  /** Set (replace) journal logs for a connection */
  setLogs: (connectionId: string, logs: ServiceLogEntry[]) => void
  /** Append new log entries to existing logs */
  appendLogs: (connectionId: string, logs: ServiceLogEntry[]) => void
  /** Update manager status */
  setStatus: (connectionId: string, status: ServiceManagerStatus) => void
  /** Set error message */
  setError: (connectionId: string, error: string | null) => void
  /** Set the selected unit name */
  setSelectedUnit: (connectionId: string, unit: string | null) => void
  /** Merge partial filter updates */
  setFilter: (connectionId: string, filter: Partial<ServiceFilter>) => void
  /** Clear all data for a connection */
  clearConnection: (connectionId: string) => void
}

export const useServiceManagerStore = create<ServiceManagerState>((set) => ({
  services: new Map(),
  details: new Map(),
  logs: new Map(),
  status: new Map(),
  errors: new Map(),
  selectedUnit: new Map(),
  filter: new Map(),

  setServices: (connectionId, services) =>
    set((state) => {
      const newServices = new Map(state.services)
      newServices.set(connectionId, services)
      return { services: newServices }
    }),

  setDetails: (connectionId, details) =>
    set((state) => {
      const newDetails = new Map(state.details)
      newDetails.set(connectionId, details)
      return { details: newDetails }
    }),

  setLogs: (connectionId, logs) =>
    set((state) => {
      const newLogs = new Map(state.logs)
      newLogs.set(connectionId, logs)
      return { logs: newLogs }
    }),

  appendLogs: (connectionId, newLogs) =>
    set((state) => {
      const logsMap = new Map(state.logs)
      const existing = logsMap.get(connectionId) || []
      const combined = [...existing, ...newLogs]
      // Cap at 10,000 entries to prevent unbounded memory growth
      if (combined.length > 10000) combined.splice(0, combined.length - 10000)
      logsMap.set(connectionId, combined)
      return { logs: logsMap }
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

  setSelectedUnit: (connectionId, unit) =>
    set((state) => {
      const newSelectedUnit = new Map(state.selectedUnit)
      newSelectedUnit.set(connectionId, unit)
      return { selectedUnit: newSelectedUnit }
    }),

  setFilter: (connectionId, partial) =>
    set((state) => {
      const newFilter = new Map(state.filter)
      const current = newFilter.get(connectionId) || { ...DEFAULT_FILTER }
      newFilter.set(connectionId, { ...current, ...partial })
      return { filter: newFilter }
    }),

  clearConnection: (connectionId) =>
    set((state) => {
      const newServices = new Map(state.services)
      const newDetails = new Map(state.details)
      const newLogs = new Map(state.logs)
      const newStatus = new Map(state.status)
      const newErrors = new Map(state.errors)
      const newSelectedUnit = new Map(state.selectedUnit)
      const newFilter = new Map(state.filter)

      newServices.delete(connectionId)
      newDetails.delete(connectionId)
      newLogs.delete(connectionId)
      newStatus.delete(connectionId)
      newErrors.delete(connectionId)
      newSelectedUnit.delete(connectionId)
      newFilter.delete(connectionId)

      return {
        services: newServices,
        details: newDetails,
        logs: newLogs,
        status: newStatus,
        errors: newErrors,
        selectedUnit: newSelectedUnit,
        filter: newFilter
      }
    })
}))
