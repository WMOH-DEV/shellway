import { useState } from 'react'
import { Check, Lock, X } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { DiffLine, SslReport, SwitchPrepared } from '@/types/ssl'
import { certificateSummary, diffCounts, nameRows, validUntilText } from '@/utils/ssl/switchWizard/switchView'
import { Button } from '@/components/ui/Button'
import { Card } from '../Card'
import { StepHeading } from '../https/StepHeading'
import { BlockedNotice } from './BlockedNotice'
import type { SwitchFlow } from './useSwitchFlow'

const Mono = ({ children }: { children: string }) => <span className="font-mono text-nd-text-primary">{children}</span>

function Summary({ flow, report, prepared }: { flow: SwitchFlow; report: SslReport; prepared: SwitchPrepared }) {
  return (
    <Card label="Certificate" ariaLabel="Certificate">
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 text-[13px]">
        <dt className="text-nd-text-muted">Certificate</dt>
        <dd className="text-nd-text-primary">{certificateSummary(prepared.keyType, prepared.validityYears)}</dd>
        <dt className="text-nd-text-muted">Valid until</dt>
        <dd className="text-nd-text-primary">{validUntilText(prepared.notAfter)}</dd>
        <dt className="text-nd-text-muted">Names in this server block</dt>
        <dd>
          <ul className="flex flex-col gap-1.5">
            {nameRows(report, flow.check).map((row) => (
              <li key={row.name} className="flex items-center gap-2">
                {row.ok ? <Check size={13} strokeWidth={2.4} className="shrink-0 text-nd-success" aria-label="ok" /> : <X size={13} strokeWidth={2.4} className="shrink-0 text-nd-error" aria-label="blocked" />}
                <span className="font-mono text-[12.5px] text-nd-text-primary">{row.name}</span>
                <span className={cn('text-xs', row.ok ? 'text-nd-text-muted' : 'text-nd-error')}>{row.detail}</span>
              </li>
            ))}
          </ul>
        </dd>
      </dl>
      <span className="flex items-center gap-1.5 text-xs text-nd-text-secondary">
        <Lock size={12} className="text-nd-success" aria-hidden /> Private key made on the server, never left it
      </span>
    </Card>
  )
}

const ROW_TONE: Record<DiffLine['kind'], string> = {
  same: 'text-nd-text-secondary',
  add: 'bg-nd-success/[.09] text-nd-success',
  remove: 'bg-nd-error/[.09] text-nd-error'
}

const ROW_SIGN: Record<DiffLine['kind'], string> = { same: ' ', add: '+', remove: '-' }

function DiffCard({ prepared }: { prepared: SwitchPrepared }) {
  const { added, removed } = diffCounts(prepared.diff)
  return (
    <Card
      label="nginx change"
      ariaLabel="nginx change"
      aside={<span className="flex gap-2 text-xs"><span className="text-nd-success">+{added}</span><span className="text-nd-error">-{removed}</span></span>}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 text-xs text-nd-text-muted">
        <span className="break-all font-mono text-nd-text-secondary">{prepared.file}</span>
        <span>server block at line {prepared.blockLine}</span>
      </div>
      <div className="flex flex-col rounded-lg bg-nd-bg-primary py-2 font-mono text-[11.5px] leading-[1.75]">
        {prepared.diff.map((line, index) => (
          <div key={index} data-kind={line.kind} className={cn('grid grid-cols-[40px_40px_16px_minmax(0,1fr)] px-2', ROW_TONE[line.kind])}>
            <span className="select-none text-right text-nd-text-muted">{line.oldLine ?? ''}</span>
            <span className="select-none text-right text-nd-text-muted">{line.newLine ?? ''}</span>
            <span className="select-none text-center">{ROW_SIGN[line.kind]}</span>
            <span className="whitespace-pre-wrap break-all">{line.text}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function RootSteps({ prepared }: { prepared: SwitchPrepared }) {
  const [showScript, setShowScript] = useState(false)
  return (
    <Card
      label="Runs as root, in one step"
      ariaLabel="Runs as root"
      aside={<Button size="sm" aria-expanded={showScript} onClick={() => setShowScript((open) => !open)}>{showScript ? 'Hide script' : 'Show script'}</Button>}
    >
      <span className="text-xs text-nd-text-secondary">
        sent to <Mono>sudo -n sh -s</Mono> so a dropped connection can't leave it half-done
      </span>
      <ol className="flex list-decimal flex-col gap-1.5 pl-[18px] text-[13px] text-nd-text-secondary">
        <li>Back up the site file to <Mono>{prepared.backupPath}</Mono></li>
        <li>Replace the two certificate lines</li>
        <li><Mono>nginx -t</Mono>, then reload. If the test fails, the backup is restored.</li>
        <li>
          Verify: the server presents the new certificate, and{' '}
          {prepared.names.map((name, index) => <span key={name}>{index > 0 && ', '}<Mono>{`https://${name}/`}</Mono></span>)}{' '}
          doesn't return 525/526. If not, restore and reload.
        </li>
      </ol>
      {showScript && <pre aria-label="Script" className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-nd-bg-primary p-3 font-mono text-[11.5px] leading-[1.7] text-nd-text-secondary">{prepared.script}</pre>}
    </Card>
  )
}

export function ReviewStep({ flow, report, prepared }: { flow: SwitchFlow; report: SslReport; prepared: SwitchPrepared }) {
  return (
    <div className="flex flex-col gap-4">
      <StepHeading title="Review the nginx change" subtitle="Cloudflare signed the certificate. Nothing in nginx has changed yet." />
      {flow.check.blockedReason && <BlockedNotice reason={flow.check.blockedReason} />}
      <Summary flow={flow} report={report} prepared={prepared} />
      <DiffCard prepared={prepared} />
      <RootSteps prepared={prepared} />
    </div>
  )
}
