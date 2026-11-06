import { cn } from '@/utils/cn'
import type { HostnameStatus, ServerFacts } from '@/types/ssl'
import { groupByBlock } from '@/utils/ssl/hostRow'
import { HostRow, SSL_COLUMNS } from './HostRow'

interface HostListProps {
  hosts: HostnameStatus[]
  facts: ServerFacts
  now: number
  onOpen: (name: string) => void
  onAddHttps: (blockId: string) => void
}

const COLUMN_TITLES = ['Hostname', 'Server certificate', 'Cloudflare', 'Renewal', '']

export function HostList({ hosts, facts, now, onOpen, onAddHttps }: HostListProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={cn('hidden px-4 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-nd-text-muted lg:grid', SSL_COLUMNS)}>
        {COLUMN_TITLES.map((title, i) => <span key={i}>{title}</span>)}
      </div>
      {groupByBlock(hosts).map((group) => (
        <div
          key={group[0].blockId}
          data-testid="host-group"
          className="divide-y divide-nd-border overflow-hidden rounded-[10px] border border-nd-border bg-nd-bg-secondary transition-colors hover:border-nd-border-hover"
        >
          {group.map((host) => <HostRow key={host.name} host={host} facts={facts} now={now} onOpen={onOpen} onAddHttps={onAddHttps} />)}
        </div>
      ))}
    </div>
  )
}
