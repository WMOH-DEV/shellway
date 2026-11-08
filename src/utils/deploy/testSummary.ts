import type { DeployRecord, SiteSummary } from '@/types/deploy'
import { newSite } from './presets'

export interface SummaryOverrides {
  config?: Partial<SiteSummary['config']>
  state?: Partial<SiteSummary['state']>
  history?: SiteSummary['history']
}

export function makeSummary(overrides: SummaryOverrides = {}): SiteSummary {
  return {
    config: { ...newSite('/var/www/example'), ...overrides.config },
    state: {
      current: 'aaa', currentRelease: 'd1', lastAttempted: 'aaa', remoteHead: 'aaa', heartbeat: 1000,
      mirrorHead: 'aaa', pending: '', behind: null, busy: false, currentSubject: '', remoteSubject: '', progress: null, cancelling: false,
      now: 1030, ...overrides.state
    },
    history: overrides.history ?? []
  }
}

export function makeRecord(overrides: Partial<DeployRecord> = {}): DeployRecord {
  return { id: 'd1', status: 'success', trigger: 'manual', commit: 'aaa', started: 1, finished: 2, warnings: 0, note: '', subject: '', ...overrides }
}
