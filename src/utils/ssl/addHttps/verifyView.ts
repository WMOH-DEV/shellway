import type { OriginCert, ReadinessCheck, VerifyResult } from '../../../types/ssl'
import { pluralize } from '../time'
import { daysLeft, KIND_LABELS } from '../verdict'

export function servedText(cert: OriginCert | null, now: number): string {
  if (cert === null || cert.kind === 'none') return 'No certificate served'
  if (cert.error) return cert.error
  const label = KIND_LABELS[cert.kind]
  return cert.notAfter === null ? label : `${label} · ${pluralize(daysLeft(cert.notAfter, now), 'day')} left`
}

const detailed = (text: string, check: ReadinessCheck): string => (check.detail ? `${text} (${check.detail})` : text)

export function verifyProblems(result: VerifyResult): string[] {
  const names = result.names.flatMap((row) => [
    ...(row.served === null || row.served.kind === 'none' ? [`${row.name} does not serve a certificate yet`] : []),
    ...(row.https.state === 'fail' ? [detailed(`${row.name} did not answer over HTTPS`, row.https)] : [])
  ])
  const renewal = result.renewalTest.state === 'fail' ? [detailed('The renewal test failed', result.renewalTest)] : []
  const timer = result.timer.state === 'fail' ? [detailed('No renewal timer is scheduled', result.timer)] : []
  return [...names, ...renewal, ...timer]
}
