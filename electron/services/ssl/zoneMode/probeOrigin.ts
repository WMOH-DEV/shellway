import { connect, rootCertificates } from 'tls'
import type { ZoneProbeState } from '../../../../src/types/ssl'
import { ORIGIN_CA_ROOTS } from './originCaRoots'

const PROBE_TIMEOUT_MS = 8_000
const HTTPS_PORT = 443

export interface ProbeTarget {
  name: string
  recordType: string
  origin: string
}

export interface ProbeOutcome {
  state: ZoneProbeState
  detail: string
}

export type OriginProbe = (target: ProbeTarget) => Promise<ProbeOutcome>

export interface ProbeOptions {
  port?: number
  timeoutMs?: number
  extraRoots?: string[]
}

export const UNREACHABLE_DETAIL = "couldn't reach the origin from this computer"

const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'])

const UNTRUSTED_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_UNTRUSTED',
  'CERT_SIGNATURE_FAILURE'
])

const SELF_SIGNED_CODES = new Set(['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'])

export const trustedRoots = (extraRoots: string[] = []): string[] => [...rootCertificates, ...ORIGIN_CA_ROOTS, ...extraRoots]

export function verificationFailure(code: string, name: string): string {
  if (code === 'CERT_HAS_EXPIRED') return 'the origin certificate has expired'
  if (code === 'CERT_NOT_YET_VALID') return 'the origin certificate is not valid yet'
  if (SELF_SIGNED_CODES.has(code)) return 'the origin certificate is self-signed'
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') return `the origin certificate does not cover ${name}`
  if (UNTRUSTED_CODES.has(code)) return "the origin certificate was issued by an authority Cloudflare doesn't trust"
  return `the origin certificate failed verification (${code})`
}

function failureOutcome(err: NodeJS.ErrnoException): ProbeOutcome {
  if (UNREACHABLE_CODES.has(err.code ?? '')) return { state: 'unknown', detail: UNREACHABLE_DETAIL }
  return { state: 'fail', detail: 'the TLS handshake with the origin failed' }
}

function authorizationCode(error: unknown): string {
  if (typeof error === 'string') return error
  return (error as NodeJS.ErrnoException | undefined)?.code ?? 'unknown'
}

export function probeOrigin(target: ProbeTarget, options: ProbeOptions = {}): Promise<ProbeOutcome> {
  return new Promise((resolve) => {
    const socket = connect({
      host: target.origin,
      port: options.port ?? HTTPS_PORT,
      servername: target.name,
      ca: trustedRoots(options.extraRoots),
      rejectUnauthorized: false
    })
    let settled = false
    const settle = (outcome: ProbeOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(outcome)
    }
    const timer = setTimeout(() => settle({ state: 'unknown', detail: UNREACHABLE_DETAIL }), options.timeoutMs ?? PROBE_TIMEOUT_MS)
    socket.once('secureConnect', () => {
      if (socket.authorized) settle({ state: 'pass', detail: 'the origin certificate is valid for strict mode' })
      else settle({ state: 'fail', detail: verificationFailure(authorizationCode(socket.authorizationError), target.name) })
    })
    socket.once('error', (err) => settle(failureOutcome(err)))
  })
}
