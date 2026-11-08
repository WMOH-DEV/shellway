import type { OriginCert, ReadinessCheck, SwitchVerifyName } from '../../../../src/types/ssl'
import { CLOUDFLARE_FAILURES } from '../https/verify'
import type { HttpGet } from '../https/httpGet'

const HTTPS_TIMEOUT_MS = 10_000
const PROBE_ATTEMPTS = 3
const PROBE_PAUSE_MS = 1_000

export interface VerifyDeps {
  probe: (names: string[]) => Promise<Record<string, OriginCert>>
  httpGet: HttpGet
  sleep: (ms: number) => Promise<void>
}

export const servedAsExpected = (results: SwitchVerifyName[], expectOrigin: boolean): boolean =>
  results.every(({ served }) => served !== null && served.error === null && (served.kind === 'cloudflare-origin') === expectOrigin)

export const httpsAcceptable = (results: SwitchVerifyName[]): boolean => results.every(({ https }) => https.state !== 'fail')

async function httpsCheck(name: string, httpGet: HttpGet): Promise<ReadinessCheck> {
  try {
    const { status } = await httpGet(`https://${name}/`, HTTPS_TIMEOUT_MS)
    if (CLOUDFLARE_FAILURES[status]) return { state: 'fail', detail: CLOUDFLARE_FAILURES[status] }
    return { state: 'ok', detail: `HTTPS answered (status ${status})` }
  } catch (err) {
    return { state: 'unknown', detail: `could not check from this computer (${(err as Error).message})` }
  }
}

async function probeUntil(deps: VerifyDeps, names: string[], expectOrigin: boolean): Promise<Record<string, OriginCert>> {
  let served: Record<string, OriginCert> = {}
  for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt++) {
    served = await deps.probe(names).catch(() => ({}))
    if (servedAsExpected(names.map((name) => ({ name, served: served[name] ?? null, https: { state: 'unknown', detail: '' } })), expectOrigin)) break
    if (attempt < PROBE_ATTEMPTS) await deps.sleep(PROBE_PAUSE_MS)
  }
  return served
}

export async function verifyServed(deps: VerifyDeps, names: string[], expectOrigin: boolean): Promise<SwitchVerifyName[]> {
  const [served, https] = await Promise.all([probeUntil(deps, names, expectOrigin), Promise.all(names.map((name) => httpsCheck(name, deps.httpGet)))])
  return names.map((name, index) => ({ name, served: served[name] ?? null, https: https[index] }))
}
