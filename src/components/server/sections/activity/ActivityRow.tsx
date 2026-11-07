import { ChevronDown, ChevronRight } from 'lucide-react'
import { copyText } from '@/components/deploy/copyText'
import { Button } from '@/components/ui/Button'
import type { ActivityEntry, RunStatus } from '@/types/server/core'
import { AREA_LABEL, commandsText, entryDetail, formatClock, formatDuration, STATUS_LABEL, WHO_LABEL } from '@/utils/server/activity/format'
import { Chip, StatusDot, type KitTone } from '../../kit'
import { ActivityStepBlock } from './ActivityStepBlock'

const STATUS_TONE: Record<RunStatus, KitTone> = {
  running: 'info',
  done: 'success',
  failed: 'error',
  stopped: 'warning',
  lost: 'warning'
}

export const ROW_COLUMNS = { gridTemplateColumns: '70px 22px minmax(0, 1fr) 110px 100px 60px 28px' }

interface ActivityRowProps {
  entry: ActivityEntry
  open: boolean
  canUndo: boolean
  onToggle(): void
  onUndo(entry: ActivityEntry): void
}

export function ActivityRow({ entry, open, canUndo, onToggle, onUndo }: ActivityRowProps) {
  return (
    <div className="border-b border-nd-border last:border-b-0">
      <button type="button" aria-expanded={open} onClick={onToggle} className="grid w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-nd-surface-hover" style={ROW_COLUMNS}>
        <span className="font-mono text-xs text-nd-text-muted">{formatClock(entry.at)}</span>
        <span className="justify-self-center"><StatusDot tone={STATUS_TONE[entry.status]} label={STATUS_LABEL[entry.status]} /></span>
        <span className="flex min-w-0 flex-col gap-px">
          <span className="truncate text-[13px] font-medium text-nd-text-primary">{entry.title}</span>
          <span className="truncate text-xs text-nd-text-muted">{entryDetail(entry)}</span>
        </span>
        <span><Chip dense>{AREA_LABEL[entry.area]}</Chip></span>
        <span className="text-xs text-nd-text-muted">{WHO_LABEL[entry.who]}</span>
        <span className="font-mono text-xs text-nd-text-muted">{formatDuration(entry.durationMs)}</span>
        <span className="text-nd-text-muted">{open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}</span>
      </button>
      {open && <ActivityDetail entry={entry} canUndo={canUndo} onUndo={onUndo} />}
    </div>
  )
}

function ActivityDetail({ entry, canUndo, onUndo }: Pick<ActivityRowProps, 'entry' | 'canUndo' | 'onUndo'>) {
  return (
    <div className="flex flex-col gap-2 pb-3.5 pl-[120px] pr-4">
      {entry.steps.length === 0 && <span className="text-xs text-nd-text-muted">No commands were run.</span>}
      {entry.steps.map((step, index) => <ActivityStepBlock key={`${entry.id}-${index}`} step={step} />)}
      <div className="flex flex-wrap gap-2 pt-1">
        {entry.undo && (
          <Button size="sm" disabled={!canUndo} title={canUndo ? undefined : 'Connect to this server to undo'} onClick={() => onUndo(entry)}>
            Undo this change
          </Button>
        )}
        {entry.steps.length > 0 && <Button size="sm" onClick={() => void copyText(commandsText(entry), 'Commands copied')}>Copy commands</Button>}
      </div>
    </div>
  )
}
