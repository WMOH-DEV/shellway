import type { ActionResult, OriginCert, PrepFacts, ReadinessCheck, VerifyName, VerifyResult } from '../../../../src/types/ssl'
import { errorCode, TIMEOUT_CODE } from './httpGet'
import type { HttpGet } from './httpGet'

const HTTPS_TIMEOUT_MS = 10_000

const TLS_FAILURES: Record<string, string> = {
  CERT_HAS_EXPIRED: 'the certificate has expired',
  ERR_TLS_CERT_ALTNAME_INVALID: 'the certificate is for a different name',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'the certificate is self-signed',
  SELF_SIGNED_CERT_IN_CHAIN: 'the certificate is self-signed',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'the certificate is not trusted',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'the certificate is not trusted',
  ECONNREFUSED: 'port 443 refused the connection',
  ENOTFOUND: 'the name does not resolve from this computer',
  [TIMEOUT_CODE]: 'no answer on port 443 within 10 seconds'
}

export const CLOUDFLARE_FAILURES: Record<number, string> = {
  525: 'Cloudflare could not complete a secure connection to the server (525)',
  526: "Cloudflare does not trust the server's certificate (526)"
}

export interface VerifyDeps {
  names: string[]
  probeServer: () => Promise<Record<string, OriginCert>>
  httpGet: HttpGet
  renewalTest: () => Promise<ActionResult>
  detect: () => Promise<PrepFacts>
}

const ok = (detail: string): ReadinessCheck => ({ state: 'ok', detail })
const fail = (detail: string): ReadinessCheck => ({ state: 'fail', detail })

function httpsStatus(status: number): ReadinessCheck {
  if (CLOUDFLARE_FAILURES[status]) return fail(CLOUDFLARE_FAILURES[status])
  return status < 500 ? ok(`HTTPS works (status ${status})`) : fail(`the site answered with an error (status ${status})`)
}

function httpsFailure(err: unknown): ReadinessCheck {
  const reason = TLS_FAILURES[errorCode(err)]
  return fail(reason ?? `could not connect (${(err as Error).message})`)
}

async function checkHttps(name: string, httpGet: HttpGet): Promise<ReadinessCheck> {
  try {
    return httpsStatus((await httpGet(`https://${name}/`, HTTPS_TIMEOUT_MS)).status)
  } catch (err) {
    return httpsFailure(err)
  }
}

export function lastMeaningfulLine(output: string): string {
  const lines = output.split('\n').map((line) => line.trim()).filter((line) => /[A-Za-z0-9]/.test(line))
  return lines[lines.length - 1] ?? 'no output'
}

async function checkRenewal(renewalTest: VerifyDeps['renewalTest']): Promise<ReadinessCheck> {
  try {
    const result = await renewalTest()
    return result.code === 0 ? ok('renewal test passed') : fail(lastMeaningfulLine(result.output))
  } catch (err) {
    return fail((err as Error).message)
  }
}

async function checkTimer(detect: VerifyDeps['detect']): Promise<ReadinessCheck> {
  try {
    const { renewalTimer } = await detect()
    return renewalTimer ? ok(`renewal timer is active (${renewalTimer})`) : fail('no renewal timer is active')
  } catch (err) {
    return { state: 'unknown', detail: (err as Error).message }
  }
}

async function servedCerts(probeServer: VerifyDeps['probeServer']): Promise<Record<string, OriginCert>> {
  try {
    return await probeServer()
  } catch {
    return {}
  }
}

async function verifyName(name: string, served: Promise<Record<string, OriginCert>>, httpGet: HttpGet): Promise<VerifyName> {
  const [certs, https] = await Promise.all([served, checkHttps(name, httpGet)])
  return { name, served: certs[name] ?? null, https }
}

export async function verifyHttps(deps: VerifyDeps): Promise<VerifyResult> {
  const served = servedCerts(deps.probeServer)
  const [names, renewalTest, timer] = await Promise.all([
    Promise.all(deps.names.map((name) => verifyName(name, served, deps.httpGet))),
    checkRenewal(deps.renewalTest),
    checkTimer(deps.detect)
  ])
  return { names, renewalTest, timer }
}
