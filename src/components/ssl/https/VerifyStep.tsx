import { AlertTriangle, Check } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import type { VerifyResult } from '@/types/ssl'
import { servedText, verifyProblems } from '@/utils/ssl/addHttps/verifyView'
import { nowSeconds } from '@/utils/ssl/time'
import { ErrorBanner } from '../LoadState'
import { CardLabel } from '../Card'
import { CheckText } from './CheckText'
import { StepHeading } from './StepHeading'
import type { Verify } from './useVerify'

function NameRows({ result }: { result: VerifyResult }) {
  const now = nowSeconds()
  return (
    <section aria-label="Names" className="overflow-hidden rounded-[10px] border border-nd-border bg-nd-bg-secondary">
      <div className="border-b border-nd-border px-4 py-3"><CardLabel>Served certificate</CardLabel></div>
      {result.names.map((row) => (
        <div key={row.name} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1fr)] items-center gap-3.5 border-b border-nd-border px-4 py-2.5 last:border-b-0">
          <span className="truncate font-mono text-[12.5px] text-nd-text-primary">{row.name}</span>
          <span className="truncate text-[12.5px] text-nd-text-secondary">{servedText(row.served, now)}</span>
          <CheckText check={row.https} fallback={row.https.state === 'ok' ? 'HTTPS works' : 'not checked'} />
        </div>
      ))}
    </section>
  )
}

function RenewalRows({ result }: { result: VerifyResult }) {
  return (
    <section aria-label="Renewal" className="flex flex-col gap-2.5 rounded-[10px] border border-nd-border bg-nd-bg-secondary p-4">
      <CardLabel>Renewal</CardLabel>
      <div className="flex items-center gap-3 text-[13px] text-nd-text-primary">
        <span className="w-32 shrink-0">Renewal test</span>
        <CheckText check={result.renewalTest} fallback={result.renewalTest.state === 'ok' ? 'dry run passed' : 'not checked'} />
      </div>
      <div className="flex items-center gap-3 text-[13px] text-nd-text-primary">
        <span className="w-32 shrink-0">Renewal timer</span>
        <CheckText check={result.timer} fallback={result.timer.state === 'ok' ? 'scheduled' : 'not checked'} />
      </div>
    </section>
  )
}

function Problems({ problems }: { problems: string[] }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-[10px] border border-nd-error/30 bg-nd-error/10 px-3.5 py-3 text-[13px] text-nd-text-secondary">
      <AlertTriangle size={15} className="mt-px shrink-0 text-nd-error" aria-hidden />
      <div className="flex flex-col gap-1">
        {problems.map((problem) => <span key={problem}>{problem}</span>)}
        <span className="text-nd-text-primary">The certificate itself is issued and installed. Fix this, then press Verify again.</span>
      </div>
    </div>
  )
}

function Success() {
  return (
    <div role="status" className="flex items-center gap-2.5 rounded-[10px] border border-nd-success/35 bg-nd-success/5 px-3.5 py-3 text-[13px] text-nd-text-secondary">
      <Check size={15} className="text-nd-success" aria-hidden /> HTTPS is on and renewal works. The hostnames now show the new certificate.
    </div>
  )
}

export function VerifyStep({ verify }: { verify: Verify }) {
  const { result, error, loading } = verify
  const problems = result ? verifyProblems(result) : []
  return (
    <div className="flex flex-col gap-4">
      <StepHeading title="Verify" subtitle="Shellway checks what visitors get and that renewal will work." />
      {error && <ErrorBanner message={error} retrying={loading} onRetry={() => void verify.run()} />}
      {!result && loading && <div role="status" aria-label="Verifying" className="flex justify-center py-16"><Spinner size="md" /></div>}
      {result && (problems.length === 0 ? <Success /> : <Problems problems={problems} />)}
      {result && <NameRows result={result} />}
      {result && <RenewalRows result={result} />}
    </div>
  )
}
