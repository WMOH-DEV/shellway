import type { OriginKeyType, OriginValidityYears } from '../../../types/ssl'
import type { StepState } from '../addHttps/steps'
import { pluralize } from '../time'

export type SwitchStep = 'explain' | 'key' | 'sign' | 'review' | 'apply'

export const SWITCH_STEPS: { id: SwitchStep; title: string }[] = [
  { id: 'explain', title: 'Explain and confirm' },
  { id: 'key', title: 'Key and CSR on server' },
  { id: 'sign', title: 'Cloudflare signs' },
  { id: 'review', title: 'Review nginx change' },
  { id: 'apply', title: 'Apply and verify' }
]

const ORDER = SWITCH_STEPS.map((step) => step.id)

export function stepState(step: SwitchStep, current: SwitchStep): StepState {
  if (step === current) return 'current'
  return ORDER.indexOf(step) < ORDER.indexOf(current) ? 'done' : 'todo'
}

export const KEY_LABELS: Record<OriginKeyType, string> = { ecc: 'ECC', rsa: 'RSA' }

export const VALIDITY_CHOICES: readonly OriginValidityYears[] = [1, 2, 3, 15]

export const validityLabel = (years: OriginValidityYears): string => pluralize(years, 'year')

export function prepareStage(output: string): 'key' | 'sign' {
  return /cloudflare/i.test(output) ? 'sign' : 'key'
}

export interface StepDetailInput {
  keyType: OriginKeyType
  years: OriginValidityYears
  nameCount: number
}

export function stepDetails({ keyType, years, nameCount }: StepDetailInput): Record<SwitchStep, string> {
  return {
    explain: `${validityLabel(years)} · ${KEY_LABELS[keyType]}`,
    key: 'private key stays on the server',
    sign: 'Cloudflare Origin CA',
    review: pluralize(nameCount, 'name'),
    apply: 'backup, reload, verify'
  }
}
