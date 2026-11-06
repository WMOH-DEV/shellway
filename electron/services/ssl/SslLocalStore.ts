import Store from 'electron-store'
import { encrypt, decrypt, generateMasterKey } from '../../utils/encryption'
import type { AlertSettings, UnreachableHost, Verdict } from '../../../src/types/ssl'

export interface KnownHost {
  host: string
  address: string
  port: number
}

interface Schema {
  masterKey: string
  cloudflareToken: string
  knownHosts: Record<string, KnownHost[]>
  probeEnabled: boolean
  lastAlert: AlertSettings['lastAlert']
  alerted: Record<string, number>
  unreachable: UnreachableHost[]
  probedAt: Record<string, number>
}

const DEFAULTS: Schema = {
  masterKey: '',
  cloudflareToken: '',
  knownHosts: {},
  probeEnabled: true,
  lastAlert: null,
  alerted: {},
  unreachable: [],
  probedAt: {}
}

const toSeconds = (ms: number) => Math.floor(ms / 1000)

export class SslLocalStore {
  private readonly store = new Store<Schema>({ name: 'shellway-ssl', defaults: DEFAULTS })
  private readonly masterKey: string

  constructor() {
    let key = this.store.get('masterKey')
    if (!key) {
      key = generateMasterKey()
      this.store.set('masterKey', key)
    }
    this.masterKey = key
  }

  cloudflareToken(): string | null {
    const stored = this.store.get('cloudflareToken')
    if (!stored) return null
    try {
      return decrypt(stored, this.masterKey)
    } catch {
      return null
    }
  }

  setCloudflareToken(token: string | null): void {
    this.store.set('cloudflareToken', token ? encrypt(token, this.masterKey) : '')
  }

  knownHosts(): Record<string, KnownHost[]> {
    return this.store.get('knownHosts')
  }

  setKnownHosts(sessionId: string, hosts: KnownHost[]): void {
    this.store.set('knownHosts', { ...this.store.get('knownHosts'), [sessionId]: hosts })
  }

  alertSettings(): AlertSettings {
    const lastAlert = this.store.get('lastAlert')
    return {
      probeEnabled: this.store.get('probeEnabled'),
      lastAlert: lastAlert && { ...lastAlert, at: toSeconds(lastAlert.at) },
      unreachable: this.store.get('unreachable').map((u) => ({ ...u, at: toSeconds(u.at) }))
    }
  }

  setProbeEnabled(enabled: boolean): void {
    this.store.set('probeEnabled', enabled)
  }

  alertedAt(host: string, verdict: Verdict): number {
    return this.store.get('alerted')[`${host}:${verdict}`] ?? 0
  }

  markAlerted(host: string, verdict: Verdict, at: number): void {
    this.store.set('alerted', { ...this.store.get('alerted'), [`${host}:${verdict}`]: at })
    this.store.set('lastAlert', { host, verdict, at })
  }

  probedAt(host: string): number {
    return this.store.get('probedAt')[host] ?? 0
  }

  markProbed(host: string, at: number, failure: string | null): void {
    this.store.set('probedAt', { ...this.store.get('probedAt'), [host]: at })
    const others = this.store.get('unreachable').filter((u) => u.host !== host)
    this.store.set('unreachable', failure ? [...others, { host, reason: failure, at }] : others)
  }
}
