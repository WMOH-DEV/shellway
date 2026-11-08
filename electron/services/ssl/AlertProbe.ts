import { connect } from 'tls'
import type { Verdict } from '../../../src/types/ssl'
import { daysLeft, WARNING_DAYS } from '../../../src/utils/ssl/verdict'
import type { KnownHost, SslLocalStore } from './SslLocalStore'

const PROBE_EVERY_MS = 12 * 3_600_000
const ALERT_EVERY_MS = 24 * 3_600_000
const WAKE_EVERY_MS = 3_600_000
const FIRST_RUN_MS = 60_000
const CONNECT_TIMEOUT_MS = 10_000
const URGENT_DAYS = 7

export interface ProbeResult {
  notAfter: number
}

export type AlertProbeStore = Pick<SslLocalStore, 'knownHosts' | 'alertSettings' | 'probedAt' | 'markProbed' | 'alertedAt' | 'markAlerted'>

export interface AlertProbeDeps {
  store: AlertProbeStore
  probe: (host: KnownHost) => Promise<ProbeResult>
  notify: (title: string, body: string) => void
  now: () => number
}

export function alertLevel(days: number): Verdict | null {
  if (days < 0) return 'broken'
  if (days <= URGENT_DAYS) return 'will-break'
  if (days <= WARNING_DAYS) return 'expiring'
  return null
}

const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`

function alertText(host: string, days: number): [string, string] {
  if (days < 0) return ['Server certificate expired', `${host}: server certificate expired ${plural(-days)} ago`]
  return ['Server certificate expires soon', `${host}: server certificate expires in ${plural(days)}`]
}

export function tlsProbe({ host, address, port }: KnownHost): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: address, port, servername: host, rejectUnauthorized: false, timeout: CONNECT_TIMEOUT_MS })
    const fail = (err: Error) => { socket.destroy(); reject(err) }
    socket.once('secureConnect', () => {
      const validTo = socket.getPeerCertificate()?.valid_to
      socket.end()
      const notAfter = validTo ? Date.parse(validTo) / 1000 : NaN
      if (Number.isNaN(notAfter)) reject(new Error('no certificate'))
      else resolve({ notAfter })
    })
    socket.once('timeout', () => fail(new Error('timed out')))
    socket.once('error', fail)
  })
}

export class AlertProbe {
  private timer: ReturnType<typeof setInterval> | null = null
  private first: ReturnType<typeof setTimeout> | null = null
  private running = false

  constructor(private readonly deps: AlertProbeDeps) {}

  start(): void {
    if (this.timer) return
    this.first = setTimeout(() => void this.runOnce(), FIRST_RUN_MS)
    this.timer = setInterval(() => void this.runOnce(), WAKE_EVERY_MS)
    this.first.unref?.()
    this.timer.unref?.()
  }

  stop(): void {
    if (this.first) clearTimeout(this.first)
    if (this.timer) clearInterval(this.timer)
    this.first = null
    this.timer = null
  }

  async runOnce(): Promise<void> {
    if (this.running || !this.deps.store.alertSettings().probeEnabled) return
    this.running = true
    try {
      for (const host of this.dueHosts()) await this.check(host)
    } finally {
      this.running = false
    }
  }

  private dueHosts(): KnownHost[] {
    const now = this.deps.now()
    const unique = new Map<string, KnownHost>()
    for (const hosts of Object.values(this.deps.store.knownHosts())) {
      for (const host of hosts) if (!unique.has(host.host)) unique.set(host.host, host)
    }
    return [...unique.values()].filter((h) => now - this.deps.store.probedAt(h.host) >= PROBE_EVERY_MS)
  }

  private async check(host: KnownHost): Promise<void> {
    const { store, probe, now } = this.deps
    try {
      const { notAfter } = await probe(host)
      store.markProbed(host.host, now(), null)
      this.alertIfNeeded(host.host, daysLeft(notAfter, Math.floor(now() / 1000)))
    } catch (err) {
      store.markProbed(host.host, now(), (err as Error).message)
    }
  }

  private alertIfNeeded(host: string, days: number): void {
    const level = alertLevel(days)
    const { store, notify, now } = this.deps
    if (!level || now() - store.alertedAt(host, level) < ALERT_EVERY_MS) return
    store.markAlerted(host, level, now())
    notify(...alertText(host, days))
  }
}
