import type { ActionResult, CertbotAction, HostnameStatus, ServerFacts } from '../../types/ssl'
import { LINEAGE_NAME } from './commands'
import { isRenewalHealthy } from './hostRow'

export interface ActionAvailability {
  allowed: boolean
  reason: string | null
}

export interface ActionCopy {
  title: string
  note: string
  button: string
}

export const ACTION_COPY: Record<Exclude<CertbotAction, 'force'>, ActionCopy> = {
  test: { title: 'Test renewal', note: "Uses Let's Encrypt staging. Safe to repeat.", button: 'Run test' },
  renew: { title: 'Renew now', note: 'Renews only if due.', button: 'Renew' }
}

export const FORCE_COPY = {
  link: 'Force renew…',
  title: 'Force renewal?',
  body: "This asks Let's Encrypt for a new certificate even though the current one is not due. Let's Encrypt limits duplicate certificates to 5 per week for the same set of names, so forcing it repeatedly can lock you out of renewing for days.",
  confirm: 'Force renew'
}

export function actionAvailability(host: HostnameStatus, facts: ServerFacts): ActionAvailability {
  if (!facts.certbot) return { allowed: false, reason: 'certbot is not installed on this server.' }
  if (!host.lineage) return { allowed: false, reason: 'No certbot certificate was found for this name, so there is nothing to renew from here.' }
  if (!LINEAGE_NAME.test(host.lineage)) return { allowed: false, reason: 'The certbot certificate name has characters Shellway will not pass to the server.' }
  if (!facts.sudo.certbot) return { allowed: false, reason: 'Passwordless sudo for certbot is missing. Add it under Server checks to run certbot from Shellway.' }
  return { allowed: true, reason: null }
}

export function shouldEmphasizeTest(host: HostnameStatus, facts: ServerFacts): boolean {
  return !isRenewalHealthy(facts) || host.verdict === 'broken' || host.verdict === 'will-break' || host.verdict === 'expiring'
}

const OUTCOME_NAMES: Record<CertbotAction, string> = {
  test: 'Test renewal',
  renew: 'Renewal',
  force: 'Forced renewal'
}

export interface ActionOutcome {
  action: CertbotAction
  success: boolean
  message: string
}

export function actionOutcome(action: CertbotAction, result: ActionResult | null, error?: string): ActionOutcome {
  const name = OUTCOME_NAMES[action]
  if (!result) return { action, success: false, message: `${name} could not run${error ? `: ${error}` : ''}` }
  if (result.code === 0) return { action, success: true, message: `${name} succeeded` }
  return { action, success: false, message: `${name} failed (exit ${result.code})` }
}
