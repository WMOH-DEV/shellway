import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Copy, Download, Loader2, Minus, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import { toast } from '@/components/ui/Toast'
import { cn } from '@/utils/cn'
import type { DeployRecord, SiteSummary } from '@/types/deploy'
import { duration, isInterrupted, shortSha } from '@/utils/deploy/siteStatus'
import { triggerLabel } from '@/utils/deploy/siteRow'
import { recordTitle, runStatus, type RunStatusTone } from '@/utils/deploy/siteDetail'
import { parseRunLog, plainLogText } from '@/utils/deploy/runLog'
import { failureView, skippedRows, stageTime, stageViews, type FailureView, type StageState, type StageView } from '@/utils/deploy/runSummary'
import { copyText } from '../copyText'
import { LogViewer } from './LogViewer'
import { useRunLog } from './useRunLog'

interface RunPanelProps {
  connectionId: string
  summary: SiteSummary
  record: DeployRecord
  retry: { allowed: boolean; disabled: boolean; onRetry: () => void }
}

export const TONE_CHIP: Record<RunStatusTone, string> = {
  success: 'bg-nd-success/[.12] text-nd-success',
  warning: 'bg-nd-warning/[.12] text-nd-warning',
  error: 'bg-nd-error/[.12] text-nd-error',
  info: 'bg-nd-info/[.12] text-nd-info',
  muted: 'bg-nd-surface-hover text-nd-text-muted'
}

const STAGE_STYLE: Record<StageState, { bar: string; text: string; icon: ReactNode }> = {
  done: { bar: 'bg-nd-success', text: 'text-nd-text-secondary', icon: <Check size={13} className="text-nd-success" /> },
  warning: { bar: 'bg-nd-warning', text: 'text-nd-text-secondary', icon: <AlertTriangle size={13} className="text-nd-warning" /> },
  failed: { bar: 'bg-nd-error', text: 'text-nd-error', icon: <X size={13} /> },
  running: { bar: 'bg-nd-info animate-pulse', text: 'text-nd-info', icon: <Loader2 size={13} className="animate-spin" /> },
  cancelled: { bar: 'bg-nd-text-muted', text: 'text-nd-text-muted', icon: <X size={13} /> },
  pending: { bar: 'bg-nd-border', text: 'text-nd-text-muted', icon: <Minus size={13} /> },
  skipped: { bar: 'bg-nd-border', text: 'text-nd-text-muted', icon: <Minus size={13} /> }
}

function StageBar({ stages }: { stages: StageView[] }) {
  return (
    <ol aria-label="Pipeline stages" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
      {stages.map((stage) => {
        const style = STAGE_STYLE[stage.state]
        return (
          <li key={stage.id} className="flex min-w-0 flex-col gap-1.5">
            <div className={cn('h-1 rounded-full', style.bar)} />
            <div className={cn('flex min-w-0 items-center gap-1.5 text-xs', style.text)}>
              {style.icon}
              <span className="truncate font-medium">{stage.label}</span>
              <span className="ml-auto shrink-0 font-mono text-nd-text-muted">{stageTime(stage)}</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function FailureCallout({ failure, onJump }: { failure: FailureView; onJump: () => void }) {
  const during = failure.stageLabel ? ` during ${failure.stageLabel}` : ''
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-nd-error/30 bg-nd-error/[.08] px-3.5 py-2.5 text-[13px] text-nd-text-secondary">
      <AlertTriangle size={15} className="shrink-0 text-nd-error" />
      <span className="min-w-0 flex-1">
        {failure.command
          ? <><b className="font-mono font-semibold text-nd-text-primary">{failure.command}</b> exited with {failure.exitCode}{during}. </>
          : <>The deploy failed{during}. </>}
        {failure.outcome}
      </span>
      {failure.sectionKey && <Button size="sm" onClick={onJump}>Jump to error</Button>}
    </div>
  )
}

async function downloadLog(name: string, text: string): Promise<void> {
  const result = await window.novadeck.dialog.saveFile({ title: 'Save deploy log', defaultPath: name, filters: [{ name: 'Log', extensions: ['log', 'txt'] }] })
  if (result.canceled || !result.filePath) return
  await window.novadeck.fs.writeFile(result.filePath, text)
  toast.success('Log saved')
}

function runMeta(record: DeployRecord): string {
  const started = new Date(record.started * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return [triggerLabel(record.trigger), record.commit && shortSha(record.commit), started, duration(record)].filter(Boolean).join(' · ')
}

export function RunPanel({ connectionId, summary, record, retry }: RunPanelProps) {
  const { config, state } = summary
  const interrupted = isInterrupted(record, summary)
  const live = record.status === 'running' && state.busy
  const { text, error } = useRunLog(connectionId, config.name, record.id, live)
  const [jump, setJump] = useState(0)

  const parsed = useMemo(() => parseRunLog(text), [text])
  const stages = stageViews(parsed, record, config, state.now, interrupted)
  const failure = failureView(parsed, record, config, state.current, interrupted)
  const skipped = skippedRows(parsed, record, config)
  const status = runStatus(record, summary)
  const plain = () => plainLogText(text)

  return (
    <section aria-label="Run details" className="flex h-full min-w-0 flex-col gap-3.5 p-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="min-w-0 truncate text-[15px] font-semibold text-nd-text-primary">{recordTitle(record)}</h2>
        <span className={cn('shrink-0 rounded-md px-2 py-0.5 text-xs font-medium', TONE_CHIP[status.tone])}>{status.label}</span>
        <span className="min-w-0 truncate text-xs text-nd-text-muted">{runMeta(record)}</span>
        <div className="flex-1" />
        {retry.allowed && (
          <Button size="sm" onClick={retry.onRetry} disabled={retry.disabled}><RotateCcw size={13} /> Retry</Button>
        )}
        <Tooltip content="Copy log">
          <Button size="icon" variant="ghost" aria-label="Copy log" disabled={!text} onClick={() => copyText(plain(), 'Log')}><Copy size={14} /></Button>
        </Tooltip>
        <Tooltip content="Download log">
          <Button size="icon" variant="ghost" aria-label="Download log" disabled={!text} onClick={() => void downloadLog(`${config.name}-${record.id}.log`, plain())}><Download size={14} /></Button>
        </Tooltip>
      </div>
      {stages.length > 0 && <StageBar stages={stages} />}
      {failure && <FailureCallout failure={failure} onJump={() => setJump((n) => n + 1)} />}
      {record.status === 'cancelled' && record.note && <div className="text-xs text-nd-text-muted">{record.note}</div>}
      {error && <div className="text-xs text-nd-error">{error}</div>}
      <LogViewer
        sections={parsed.sections}
        skipped={skipped}
        live={live}
        focusKey={failure?.sectionKey ?? null}
        focusRequest={jump}
        empty={live ? 'Starting…' : 'No log output'}
      />
    </section>
  )
}
