import { Cloud, Server, User } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { HostnameStatus, ServerFacts } from '@/types/ssl'
import { diagramView } from '@/utils/ssl/diagram'
import { Card } from '../Card'
import { CLOUDFLARE_ORANGE } from '../tones'
import { Connector } from './Connector'
import { DiagramCard } from './DiagramCard'
import { WhyTwo } from './WhyTwo'

const THREE_COLUMNS = 'grid-cols-[96px_minmax(0,0.55fr)_minmax(0,1.4fr)]'
const FIVE_COLUMNS = 'grid-cols-[96px_minmax(0,0.55fr)_minmax(0,1.4fr)_minmax(0,0.55fr)_minmax(0,1.4fr)]'

function VisitorNode() {
  return (
    <div className="flex flex-col items-center gap-1.5 text-nd-text-secondary">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-nd-border-hover bg-nd-bg-primary"><User size={20} /></span>
      <span className="text-xs">Visitor</span>
    </div>
  )
}

export function Diagram({ host, facts, now }: { host: HostnameStatus; facts: ServerFacts; now: number }) {
  const view = diagramView(host, facts, now)
  const serverIcon = <Server size={16} className="text-nd-text-secondary" />
  return (
    <Card label="Two certificates, two connections" ariaLabel="The two HTTPS connections" aside={view.cloudflare ? <WhyTwo /> : undefined} className="gap-4 px-5 pb-[18px] pt-5">
      <div className={cn('grid items-center', view.cloudflare ? FIVE_COLUMNS : THREE_COLUMNS)}>
        <VisitorNode />
        <Connector view={view.visitorLeg} />
        {view.cloudflare ? (
          <>
            <DiagramCard title="Cloudflare" icon={<Cloud size={16} style={host.edge.state === 'proxied' ? { color: CLOUDFLARE_ORANGE } : undefined} className="text-nd-text-muted" />} view={view.cloudflare} />
            {view.originLeg && <Connector view={view.originLeg} />}
            <DiagramCard title="Your server" icon={serverIcon} view={view.server} />
          </>
        ) : (
          <DiagramCard title="Your server" icon={serverIcon} view={view.server} />
        )}
      </div>
    </Card>
  )
}
