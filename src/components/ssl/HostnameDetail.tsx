import { useState } from 'react'
import { timeAgo } from '@/utils/deploy/siteStatus'
import type { HostnameStatus, SslReport } from '@/types/ssl'
import { certbotCommand } from '@/utils/ssl/commands'
import { verdictHeadline } from '@/utils/ssl/hostRow'
import { ErrorBanner } from './LoadState'
import { ActionsCard } from './detail/ActionsCard'
import { DetailHeader } from './detail/DetailHeader'
import { Diagram } from './detail/Diagram'
import { FactsCard } from './detail/FactsCard'
import { ForceRenewModal } from './detail/ForceRenewModal'
import { RenewalCard } from './detail/RenewalCard'
import type { CertbotRun } from './detail/useCertbotRun'

interface HostnameDetailProps {
  host: HostnameStatus
  report: SslReport
  now: number
  loading: boolean
  error: string | null
  run: CertbotRun
  onBack: () => void
  onRefresh: () => Promise<void>
}

export function HostnameDetail({ host, report, now, loading, error, run, onBack, onRefresh }: HostnameDetailProps) {
  const { facts, blocks } = report
  const [confirmForce, setConfirmForce] = useState(false)
  const block = blocks.find((b) => b.id === host.blockId)

  const force = () => {
    setConfirmForce(false)
    if (host.lineage) void run.start(host.lineage, 'force')
  }

  return (
    <div className="h-full overflow-y-auto bg-nd-bg-primary">
      <div className="mx-auto flex min-h-full w-full max-w-[1400px] flex-col gap-4 px-7 pb-7 pt-[18px]">
        <DetailHeader
          name={host.name}
          headline={verdictHeadline(host, now)}
          checkedAgo={timeAgo(report.checkedAt, now)}
          loading={loading}
          onBack={onBack}
          onRefresh={() => void onRefresh()}
        />
        {error && <ErrorBanner message={error} retrying={loading} onRetry={() => void onRefresh()} />}
        <Diagram host={host} facts={facts} now={now} />
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <ActionsCard host={host} facts={facts} run={run} onForce={() => setConfirmForce(true)} />
          <FactsCard host={host} block={block} now={now} />
        </div>
        {facts.certbot && <RenewalCard renewal={facts.renewal} />}
      </div>
      {confirmForce && host.lineage && (
        <ForceRenewModal command={certbotCommand(host.lineage, 'force')} onConfirm={force} onClose={() => setConfirmForce(false)} />
      )}
    </div>
  )
}
