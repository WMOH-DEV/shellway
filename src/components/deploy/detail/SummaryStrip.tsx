import type { ReactNode } from 'react'
import { Copy, Laptop, Server } from 'lucide-react'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/utils/cn'
import type { RemoteDrift, SiteSummary } from '@/types/deploy'
import { shortSha } from '@/utils/deploy/siteStatus'
import { shortPath } from '@/utils/deploy/siteRow'
import { copyText } from '../copyText'
import { layoutLabel, liveCaption, newestView, repoLabel, sourceView, type SourceView } from '@/utils/deploy/siteDetail'

const DOT: Record<SourceView['tone'], string> = {
  success: 'bg-nd-success',
  warning: 'bg-nd-warning',
  muted: 'bg-nd-text-muted'
}

function Cell({ label, children, caption }: { label: string; children: ReactNode; caption: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-4 py-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-nd-text-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-2 text-[13px] text-nd-text-primary">{children}</div>
      <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-nd-text-muted">{caption}</span>
    </div>
  )
}

function Commit({ sha, subject }: { sha: string; subject: string }) {
  return (
    <>
      <span className="shrink-0 rounded bg-nd-bg-tertiary px-1.5 py-px font-mono text-xs text-nd-text-secondary">{shortSha(sha)}</span>
      <span className="truncate">{subject}</span>
    </>
  )
}

export function SummaryStrip({ summary, pcDrift, user }: { summary: SiteSummary; pcDrift?: RemoteDrift; user: string }) {
  const { config, state } = summary
  const newest = newestView(summary, pcDrift)
  const source = sourceView(summary)
  const SourceIcon = config.sourceMode === 'auto' ? Server : Laptop
  return (
    <section aria-label="Site summary" className="grid grid-cols-2 divide-nd-border rounded-[10px] border border-nd-border bg-nd-surface lg:grid-cols-4 lg:divide-x">
      <Cell label="Live now" caption={liveCaption(summary)}>
        {state.current ? <Commit sha={state.current} subject={state.currentSubject} /> : <span className="text-nd-text-muted">Nothing live yet</span>}
      </Cell>
      <Cell label={`Newest on ${config.branch}`} caption={newest?.caption ?? 'Not checked yet'}>
        {newest ? <Commit sha={newest.head} subject={newest.subject} /> : <span className="text-nd-text-muted">Unknown</span>}
      </Cell>
      <Cell label="Source" caption={<><span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[source.tone])} />{source.caption}</>}>
        <SourceIcon size={14} className="shrink-0 text-nd-text-muted" />
        <span className="truncate">{source.label}</span>
      </Cell>
      <Cell label="Location" caption={`${repoLabel(config.repoUrl)} · ${layoutLabel(config)}`}>
        <Tooltip content={config.path} triggerClassName="min-w-0">
          <span className="truncate font-mono text-xs">{shortPath(config.path, user)}</span>
        </Tooltip>
        <button
          type="button"
          aria-label="Copy full path"
          onClick={() => copyText(config.path, 'Path copied')}
          className="shrink-0 rounded p-1 text-nd-text-muted transition-colors hover:bg-nd-surface-hover hover:text-nd-text-primary"
        >
          <Copy size={12} />
        </button>
      </Cell>
    </section>
  )
}
