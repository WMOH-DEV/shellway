export type HttpsStep = 'site' | 'prepare' | 'issue' | 'verify'
export type StepState = 'done' | 'current' | 'todo'

export const HTTPS_STEPS: { id: HttpsStep; title: string }[] = [
  { id: 'site', title: 'Site and certificate' },
  { id: 'prepare', title: 'Prepare server' },
  { id: 'issue', title: 'Review and issue' },
  { id: 'verify', title: 'Verify' }
]

const ORDER: HttpsStep[] = HTTPS_STEPS.map((step) => step.id)

function move(step: HttpsStep, delta: 1 | -1, prepareSkipped: boolean): HttpsStep {
  const target = ORDER[Math.min(ORDER.length - 1, Math.max(0, ORDER.indexOf(step) + delta))]
  return target === 'prepare' && prepareSkipped ? ORDER[ORDER.indexOf(target) + delta] : target
}

export const nextStep = (step: HttpsStep, prepareSkipped: boolean): HttpsStep => move(step, 1, prepareSkipped)

export const previousStep = (step: HttpsStep, prepareSkipped: boolean): HttpsStep => move(step, -1, prepareSkipped)

export function stepState(step: HttpsStep, current: HttpsStep, prepareSkipped: boolean): StepState {
  if (step === current) return 'current'
  if (step === 'prepare' && prepareSkipped) return 'done'
  return ORDER.indexOf(step) < ORDER.indexOf(current) ? 'done' : 'todo'
}

export interface StepDetailInput {
  siteTitle: string | null
  nameCount: number
  certbotVersion: string | null
  prepareSkipped: boolean
  staging: boolean
}

export function stepDetails({ siteTitle, nameCount, certbotVersion, prepareSkipped, staging }: StepDetailInput): Record<HttpsStep, string> {
  const names = `${nameCount} ${nameCount === 1 ? 'name' : 'names'}`
  return {
    site: siteTitle ? `${siteTitle} · ${names}` : 'pick a site',
    prepare: prepareSkipped ? `${certbotVersion ? `certbot ${certbotVersion}` : 'certbot'} ready` : 'install certbot',
    issue: staging ? 'staging test first' : 'issue directly',
    verify: 'HTTPS + renewal test'
  }
}
