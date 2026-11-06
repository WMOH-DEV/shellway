import type { SwitchPrepared } from '../../../../src/types/ssl'

const UNKNOWN = 'This switch is no longer prepared. Start it again.'

export class PreparedSwitches {
  private readonly bySwitchId = new Map<string, { connectionId: string; prepared: SwitchPrepared }>()

  add(connectionId: string, prepared: SwitchPrepared): void {
    this.bySwitchId.set(prepared.switchId, { connectionId, prepared })
  }

  take(connectionId: string, switchId: string): SwitchPrepared {
    const entry = this.bySwitchId.get(switchId)
    if (!entry || entry.connectionId !== connectionId) throw new Error(UNKNOWN)
    this.bySwitchId.delete(switchId)
    return entry.prepared
  }

  forget(connectionId: string): void {
    for (const [switchId, entry] of this.bySwitchId) {
      if (entry.connectionId === connectionId) this.bySwitchId.delete(switchId)
    }
  }
}
