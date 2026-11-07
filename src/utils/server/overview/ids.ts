import type { ServerRoute } from '@/types/server/core'

export const LOAD_PROBE = 'overview.load'
export const DISK_PROBE = 'overview.disk'
export const REBOOT_PROBE = 'overview.reboot'
export const SYSTEM_PROBE = 'overview.system'
export const CLEANUP_PROBE = 'overview.cleanup'
export const FOLDERS_PROBE = 'overview.folders'

export const ON_DEMAND_PROBES: readonly string[] = [CLEANUP_PROBE, FOLDERS_PROBE]

export const REBOOT_ACTION = 'overview.reboot'
export const APT_CLEAN_ACTION = 'overview.apt-clean'
export const AUTOREMOVE_ACTION = 'overview.apt-autoremove'
export const JOURNAL_VACUUM_ACTION = 'overview.journal-vacuum'

export const OVERVIEW_ROUTE: ServerRoute = { section: 'overview' }
export const METRICS_ROUTE: ServerRoute = { section: 'overview', sub: 'metrics' }
export const DISK_ROUTE: ServerRoute = { section: 'overview', sub: 'disk' }
export const REBOOT_ROUTE: ServerRoute = { section: 'overview', params: { action: 'reboot' } }
