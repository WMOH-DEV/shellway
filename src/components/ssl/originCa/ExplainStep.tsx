import type { HostnameStatus, SslReport } from '@/types/ssl'
import { nowSeconds } from '@/utils/ssl/time'
import { Card } from '../Card'
import { Diagram } from '../detail/Diagram'
import { StepHeading } from '../https/StepHeading'
import { BlockedNotice } from './BlockedNotice'
import { SwitchOptions } from './SwitchOptions'
import type { SwitchFlow } from './useSwitchFlow'

interface ExplainStepProps {
  flow: SwitchFlow
  report: SslReport
  host: HostnameStatus
}

function WhatChanges({ names }: { names: string[] }) {
  return (
    <Card label="What changes" ariaLabel="What changes">
      <ul className="flex list-disc flex-col gap-1.5 pl-[18px] text-[13px] text-nd-text-secondary">
        <li>Only the certificate your server presents to Cloudflare. Visitors keep seeing Cloudflare's own certificate.</li>
        <li>
          It covers every name in this server block:{' '}
          {names.map((name, index) => (
            <span key={name}>{index > 0 && ', '}<span className="font-mono text-[12.5px] text-nd-text-primary">{name}</span></span>
          ))}
        </li>
        <li>The hostnames must stay proxied by Cloudflare (orange cloud).</li>
      </ul>
    </Card>
  )
}

export function ExplainStep({ flow, report, host }: ExplainStepProps) {
  return (
    <div className="flex flex-col gap-4">
      <StepHeading
        title="Explain and confirm"
        subtitle="Cloudflare signs a long-lived certificate for your server. Nothing changes until you review and apply it."
      />
      {flow.check.blockedReason && <BlockedNotice reason={flow.check.blockedReason} />}
      <Diagram host={host} facts={report.facts} now={nowSeconds()} />
      <WhatChanges names={flow.check.names.map((name) => name.name)} />
      <SwitchOptions flow={flow} />
    </div>
  )
}
