import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowRight, ChevronRight, Database, Play, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/utils/cn'
import type { DeployOptions, ShipCommit, ShipFile, ShipFileStatus, ShipPreview as ShipPreviewData, SiteSummary } from '@/types/deploy'
import {
  authorTone,
  deployLabel,
  fileDelta,
  initials,
  isUpToDate,
  migrationCommand,
  migrationCount,
  migrationHeadline,
  requiresReview,
  rollbackCommit,
  stageChips,
  summaryLine,
  truncationNote,
  visibleFiles,
  COLLAPSED_FILE_ROWS,
  FILE_STATUS_LABELS
} from '@/utils/deploy/shipPreview'
import { shortSha, timeAgo } from '@/utils/deploy/siteStatus'
import { deployApi } from './useDeploySites'

type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; preview: ShipPreviewData }

const LOADING: PreviewState = { status: 'loading' }

const AVATAR_TONES = ['bg-nd-info/15 text-nd-info', 'bg-nd-warning/15 text-nd-warning', 'bg-nd-success/15 text-nd-success', 'bg-nd-accent/15 text-nd-accent']

const FILE_STATUS_TONES: Record<ShipFileStatus, string> = {
  A: 'text-nd-success',
  M: 'text-nd-warning',
  D: 'text-nd-error',
  R: 'text-nd-info'
}

function usePreview(connectionId: string, siteName: string, open: boolean) {
  const [state, setState] = useState<PreviewState>(LOADING)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open) return
    let current = true
    const settle = (next: PreviewState) => { if (current) setState(next) }
    setState(LOADING)
    deployApi()
      .preview(connectionId, siteName)
      .then((result) => settle(result.success && result.data
        ? { status: 'ready', preview: result.data }
        : { status: 'error', message: result.error ?? 'Could not load what is about to ship' }))
      .catch((err: Error) => settle({ status: 'error', message: err.message }))
    return () => { current = false }
  }, [connectionId, siteName, open, attempt])

  return { state, retry: () => setAttempt((n) => n + 1) }
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="text-2xs font-semibold uppercase tracking-wider text-nd-text-muted">{children}</span>
}

function MigrationChip() {
  return <span className="inline-flex h-5 shrink-0 items-center rounded bg-nd-warning/[.12] px-1.5 text-2xs font-medium text-nd-warning">migration</span>
}

function Hash({ sha, fresh }: { sha: string; fresh?: boolean }) {
  return (
    <span className={cn('rounded px-1.5 py-px font-mono text-xs', fresh ? 'bg-nd-info/[.12] text-nd-info' : 'bg-nd-surface text-nd-text-secondary')}>
      {shortSha(sha)}
    </span>
  )
}

function Subtitle({ summary, preview }: { summary: SiteSummary; preview: ShipPreviewData | null }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-nd-text-muted">
      <span>{preview?.branch || summary.config.branch}</span>
      {preview && (
        <>
          <span>·</span>
          {preview.from ? <Hash sha={preview.from} /> : <span>first deploy</span>}
          <ArrowRight size={13} />
          <Hash sha={preview.to} fresh />
          <span>·</span>
          <span>{summaryLine(preview)}</span>
        </>
      )}
    </div>
  )
}

function CommitRow({ commit, now }: { commit: ShipCommit; now: number }) {
  return (
    <li className="flex items-center gap-3 border-b border-nd-border px-3 py-2.5 last:border-b-0">
      <span className={cn('flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-2xs font-semibold', AVATAR_TONES[authorTone(commit.author)])}>
        {initials(commit.author)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="flex items-center gap-2 text-sm font-medium text-nd-text-primary">
          <span className="truncate" title={commit.subject}>{commit.subject}</span>
          {commit.migration && <MigrationChip />}
        </span>
        <span className="truncate text-xs text-nd-text-muted">{commit.author} · {timeAgo(commit.time, now)}</span>
      </div>
      <span className="font-mono text-xs text-nd-text-muted">{shortSha(commit.sha)}</span>
    </li>
  )
}

function CommitList({ commits, now }: { commits: ShipCommit[]; now: number }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>Commits</SectionLabel>
      <ul className="overflow-hidden rounded-lg border border-nd-border">
        {commits.map((commit) => <CommitRow key={commit.sha} commit={commit} now={now} />)}
      </ul>
    </section>
  )
}

function FileRow({ file }: { file: ShipFile }) {
  const delta = fileDelta(file)
  return (
    <li className={cn('flex items-center gap-2.5 border-b border-nd-border px-3 py-1.5 last:border-b-0', file.migration && 'bg-nd-warning/5')}>
      <span className={cn('w-3 shrink-0', FILE_STATUS_TONES[file.status])} title={FILE_STATUS_LABELS[file.status]}>{file.status}</span>
      <span className="min-w-0 flex-1 truncate text-nd-text-secondary" title={file.path}>{file.path}</span>
      {file.migration && <MigrationChip />}
      <span className={cn('text-right', delta.added === 'binary' ? 'w-24 text-nd-text-muted' : 'w-11 text-nd-success')}>{delta.added}</span>
      <span className="w-11 text-right text-nd-error">{delta.removed}</span>
    </li>
  )
}

function FileList({ preview }: { preview: ShipPreviewData }) {
  const [expanded, setExpanded] = useState(false)
  const note = truncationNote(preview)
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <SectionLabel>Changed files</SectionLabel>
        <span className="text-xs text-nd-text-muted">{preview.totalFiles}</span>
        <div className="flex-1" />
        {preview.files.length > COLLAPSED_FILE_ROWS && (
          <button type="button" onClick={() => setExpanded((open) => !open)} className="text-xs text-nd-info hover:underline">
            {expanded ? 'Show fewer' : 'Show all'}
          </button>
        )}
      </div>
      <ul className="overflow-hidden rounded-lg border border-nd-border font-mono text-xs">
        {visibleFiles(preview.files, expanded).map((file) => <FileRow key={file.path} file={file} />)}
      </ul>
      {note && <span className="text-xs text-nd-text-muted">{note}</span>}
    </section>
  )
}

function MigrationCallout({ summary, preview, reviewed, onReviewed }: { summary: SiteSummary; preview: ShipPreviewData; reviewed: boolean; onReviewed: (value: boolean) => void }) {
  const command = migrationCommand(summary.config)
  return (
    <div className="flex gap-3 rounded-lg border border-nd-warning/30 bg-nd-warning/[.06] px-3.5 py-3">
      <Database size={16} className="mt-0.5 shrink-0 text-nd-warning" />
      <div className="flex flex-1 flex-col gap-2 text-sm text-nd-text-primary">
        <span>
          {migrationHeadline(migrationCount(preview))}{' '}
          {command && <>After going live Shellway runs <code className="font-mono text-xs text-nd-warning">{command}</code>. </>}
          Rolling back the code will not undo it.
        </span>
        <label className="flex cursor-pointer items-center gap-2 text-nd-text-secondary">
          <input type="checkbox" checked={reviewed} onChange={(e) => onReviewed(e.target.checked)} className="h-[15px] w-[15px] accent-nd-accent" />
          I've reviewed the migration
        </label>
      </div>
    </div>
  )
}

function WhatWillRun({ summary }: { summary: SiteSummary }) {
  const chips = stageChips(summary.config)
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>What will run</SectionLabel>
      <ol className="flex flex-wrap items-center gap-1.5">
        {chips.map((chip, index) => (
          <Fragment key={chip.id}>
            <li className="inline-flex h-7 items-center gap-1.5 rounded-md border border-nd-border bg-nd-bg-primary px-2.5 text-xs">
              <span className="font-medium text-nd-text-primary">{chip.name}</span>
              {chip.detail && <span className="text-nd-text-muted">{chip.detail}</span>}
            </li>
            {index < chips.length - 1 && <ChevronRight size={12} className="text-nd-text-muted" />}
          </Fragment>
        ))}
      </ol>
    </section>
  )
}

function UpToDate({ preview }: { preview: ShipPreviewData }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-nd-border bg-nd-surface px-3.5 py-3 text-sm text-nd-text-secondary">
      <span>
        The branch has nothing new. <Hash sha={preview.to} /> is already live. Redeploying runs the same steps again on this commit.
      </span>
    </div>
  )
}

function Loading() {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-nd-text-muted">
      <Spinner size="md" />
      Checking what is new on the branch
    </div>
  )
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-nd-error/30 bg-nd-error/[.06] px-3.5 py-3">
      <div className="flex gap-2.5 text-sm text-nd-text-primary">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-nd-error" />
        <span className="break-words">{message}</span>
      </div>
      <Button size="sm" onClick={onRetry}>Try again</Button>
    </div>
  )
}

function Body({ summary, preview, reviewed, onReviewed }: { summary: SiteSummary; preview: ShipPreviewData; reviewed: boolean; onReviewed: (value: boolean) => void }) {
  return (
    <div className="flex flex-col gap-4">
      {isUpToDate(preview) ? <UpToDate preview={preview} /> : <CommitList commits={preview.commits} now={summary.state.now} />}
      {preview.files.length > 0 && <FileList preview={preview} />}
      {requiresReview(summary, preview) && <MigrationCallout summary={summary} preview={preview} reviewed={reviewed} onReviewed={onReviewed} />}
      <WhatWillRun summary={summary} />
    </div>
  )
}

function FooterNote({ summary }: { summary: SiteSummary }) {
  if (summary.state.busy) return <span className="text-xs text-nd-warning">A deploy is already running for this site</span>
  const commit = rollbackCommit(summary)
  if (!commit) return null
  return (
    <span className="flex items-center gap-2 text-xs text-nd-text-muted">
      <RotateCcw size={14} className="text-nd-success" />
      One-click rollback to <span className="font-mono text-nd-text-secondary">{shortSha(commit)}</span> stays available
    </span>
  )
}

export interface ShipPreviewProps {
  connectionId: string
  summary: SiteSummary
  open: boolean
  onClose: () => void
  onDeploy: (options: DeployOptions) => void
  onApprove: () => void
}

export function ShipPreview({ connectionId, summary, open, onClose, onDeploy, onApprove }: ShipPreviewProps) {
  const { state, retry } = usePreview(connectionId, summary.config.name, open)
  const [reviewed, setReviewed] = useState(false)
  useEffect(() => setReviewed(false), [open])

  const preview = state.status === 'ready' ? state.preview : null
  const needsReview = preview !== null && requiresReview(summary, preview)
  const canSubmit = preview !== null && !summary.state.busy && (!needsReview || reviewed)

  const submit = () => {
    if (summary.state.pending) onApprove()
    else if (preview) onDeploy({ commit: preview.to, approved: needsReview && reviewed })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Deploy ${summary.config.name}`} maxWidth="max-w-[760px]">
      <Subtitle summary={summary} preview={preview} />
      {state.status === 'loading' && <Loading />}
      {state.status === 'error' && <LoadError message={state.message} onRetry={retry} />}
      {preview && <Body summary={summary} preview={preview} reviewed={reviewed} onReviewed={setReviewed} />}
      <footer className="sticky bottom-0 -mx-5 -mb-4 mt-4 flex flex-wrap items-center gap-2.5 border-t border-nd-border bg-nd-bg-secondary px-5 py-3">
        <FooterNote summary={summary} />
        <div className="flex-1" />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSubmit} onClick={submit}>
          <Play size={13} />
          {preview ? deployLabel(preview) : 'Deploy'}
        </Button>
      </footer>
    </Modal>
  )
}
