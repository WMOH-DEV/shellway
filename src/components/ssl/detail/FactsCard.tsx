import type { ReactNode } from 'react'
import { Copy } from 'lucide-react'
import { Tooltip } from '@/components/ui/Tooltip'
import { copyText } from '@/components/deploy/copyText'
import { cn } from '@/utils/cn'
import type { HostnameStatus, ServerBlock } from '@/types/ssl'
import { detailFacts } from '@/utils/ssl/detailFacts'
import { Card } from '../Card'
import { TONE_INK } from '../tones'

interface FactsCardProps {
  host: HostnameStatus
  block: ServerBlock | undefined
  now: number
}

const NONE = <span className="text-nd-text-muted">—</span>

function PathValue({ path, label }: { path: string; label: string }) {
  if (!path) return NONE
  return (
    <span className="flex min-w-0 items-center gap-1">
      <Tooltip content={path} triggerClassName="min-w-0">
        <span className="truncate font-mono text-xs">{path}</span>
      </Tooltip>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={() => copyText(path, `${label} copied`)}
        className="shrink-0 rounded p-1 text-nd-text-muted transition-colors hover:bg-nd-bg-tertiary hover:text-nd-text-primary"
      >
        <Copy size={12} />
      </button>
    </span>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[13px] text-nd-text-muted">{label}</dt>
      <dd className="m-0 min-w-0 text-[13px] text-nd-text-primary">{children}</dd>
    </>
  )
}

export function FactsCard({ host, block, now }: FactsCardProps) {
  const facts = detailFacts(host, block, now)
  const { servedBy, valid } = facts
  return (
    <Card label="Server certificate" ariaLabel="Facts">
      <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3.5 gap-y-2">
        <Row label="Served by">
          {servedBy
            ? <span className="font-mono text-xs">{servedBy.file}<span className="text-nd-text-muted"> : {servedBy.line}</span></span>
            : NONE}
        </Row>
        <Row label="Issuer">{facts.issuer || NONE}</Row>
        <Row label="Names">
          {facts.names.length > 0
            ? <span className="flex flex-col font-mono text-xs">{facts.names.map((name) => <span key={name} className="break-all">{name}</span>)}</span>
            : NONE}
        </Row>
        <Row label="Valid">
          {valid
            ? <>{valid.from && `${valid.from} → `}<span className={cn(TONE_INK[valid.tone])}>{valid.to}</span></>
            : NONE}
        </Row>
        <Row label="certbot lineage">
          {facts.lineage ? <span className="font-mono text-xs">{facts.lineage}</span> : <span className="text-nd-text-muted">Not managed by certbot</span>}
        </Row>
        <Row label="Certificate"><PathValue path={facts.certPath} label="certificate path" /></Row>
        <Row label="Key"><PathValue path={facts.keyPath} label="key path" /></Row>
      </dl>
    </Card>
  )
}
