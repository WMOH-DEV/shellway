import { useState } from 'react'
import { cn } from '@/utils/cn'
import { timeAgo } from '@/utils/deploy/siteStatus'
import type { HostnameStatus, SslReport } from '@/types/ssl'
import { certbotCommand } from '@/utils/ssl/commands'
import { switchCheck } from '@/utils/ssl/originCa/switchCheck'
import { verdictHeadline } from '@/utils/ssl/hostRow'
import { strictOfferZone } from '@/utils/ssl/zoneMode/zoneModeView'
import { ErrorBanner } from './LoadState'
import { ActionsCard } from './detail/ActionsCard'
import { DetailHeader } from './detail/DetailHeader'
import { Diagram } from './detail/Diagram'
import { FactsCard } from './detail/FactsCard'
import { ForceRenewModal } from './detail/ForceRenewModal'
import { RenewalCard } from './detail/RenewalCard'
import type { CertbotRun } from './detail/useCertbotRun'
import { LeftoverCard } from './originCa/LeftoverCard'

interface HostnameDetailProps {
  connectionId: string
  sessionId: string
  host: HostnameStatus
  report: SslReport
  now: number
  loading: boolean
  error: string | null
  run: CertbotRun
  onBack: () => void
  onAddHttps: (blockId: string) => void
  onSwitchOrigin: (name: string) => void
  onSetZoneStrict: (zone: string) => void
  onRefresh: () => Promise<void>
  embedded?: boolean
}

export function HostnameDetail({ connectionId, sessionId, host, report, now, loading, error, run, onBack, onAddHttps, onSwitchOrigin, onSetZoneStrict, onRefresh, embedded }: HostnameDetailProps) {
  const { facts, blocks } = report
  const [confirmForce, setConfirmForce] = useState(false)
  const block = blocks.find((b) => b.id === host.blockId)
  const strictZone = strictOfferZone(host.edge)

  const force = () => {
    setConfirmForce(false)
    if (host.lineage) void run.start(host.lineage, 'force')
  }

  return (
    <div className={cn(!embedded && 'h-full overflow-y-auto bg-nd-bg-primary')}>
      <div className={cn('flex flex-col gap-4', !embedded && 'mx-auto min-h-full w-full max-w-[1400px] px-7 pb-7 pt-[18px]')}>
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
          <ActionsCard
            host={host}
            facts={facts}
            run={run}
            onForce={() => setConfirmForce(true)}
            onAddHttps={onAddHttps}
            originBlockedReason={switchCheck(report, host.blockId).blockedReason}
            onSwitchOrigin={() => onSwitchOrigin(host.name)}
            strictZone={strictZone}
            onSetStrict={() => strictZone && onSetZoneStrict(strictZone)}
          />
          <FactsCard host={host} block={block} now={now} />
        </div>
        <LeftoverCard
          connectionId={connectionId}
          sessionId={sessionId}
          name={host.name}
          enabled={host.origin?.kind === 'cloudflare-origin'}
          onChanged={onRefresh}
        />
        {facts.certbot && <RenewalCard renewal={facts.renewal} />}
      </div>
      {confirmForce && host.lineage && (
        <ForceRenewModal command={certbotCommand(host.lineage, 'force')} onConfirm={force} onClose={() => setConfirmForce(false)} />
      )}
    </div>
  )
}
