import { ArrowDown, ArrowUp, ArrowRightLeft, Copy, GripVertical, MoreHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { cn } from '@/utils/cn'
import type { DeployStep } from '@/types/deploy'
import type { StepFlag } from '@/utils/deploy/pipelineSteps'
import { LimitField } from './LimitField'
import type { RowDrag } from './useRowDrag'

export interface RowActions {
  change: (patch: Partial<DeployStep>) => void
  moveUp: () => void
  moveDown: () => void
  duplicate: () => void
  moveToOtherStage: () => void
  remove: () => void
}

interface CommandRowProps {
  step: DeployStep
  index: number
  count: number
  label: string
  flag: StepFlag | null
  otherStageLabel: string
  drag: RowDrag
  actions: RowActions
}

const FLAG_TONES: Record<StepFlag['tone'], string> = {
  warning: 'bg-nd-warning/15 text-nd-warning',
  muted: 'bg-nd-bg-tertiary text-nd-text-secondary'
}

function ModeSwitch({ optional, onChange }: { optional: boolean; onChange: (optional: boolean) => void }) {
  const option = (isOptional: boolean, label: string, activeStyle: string) => (
    <button
      type="button"
      aria-pressed={optional === isOptional}
      title={isOptional ? 'If this fails, the deploy continues with a warning' : 'If this fails, the deploy stops'}
      className={cn(
        'h-6 rounded px-2 text-xs transition-colors',
        optional === isOptional ? activeStyle : 'text-nd-text-muted hover:text-nd-text-primary'
      )}
      onClick={() => onChange(isOptional)}
    >
      {label}
    </button>
  )
  return (
    <div className="flex gap-0.5 rounded-md border border-nd-border p-0.5">
      {option(false, 'Required', 'bg-nd-surface-hover text-nd-text-primary')}
      {option(true, 'Optional', 'bg-nd-warning/15 text-nd-warning')}
    </div>
  )
}

export function CommandRow({ step, index, count, label, flag, otherStageLabel, drag, actions }: CommandRowProps) {
  const menuItems = [
    { id: 'up', label: 'Move up', icon: <ArrowUp size={13} />, disabled: index === 0 },
    { id: 'down', label: 'Move down', icon: <ArrowDown size={13} />, disabled: index === count - 1 },
    { id: 'duplicate', label: 'Duplicate', icon: <Copy size={13} /> },
    { id: 'other', label: `Move to ${otherStageLabel}`, icon: <ArrowRightLeft size={13} /> },
    { id: 'separator', label: '', separator: true },
    { id: 'delete', label: 'Delete', icon: <Trash2 size={13} />, danger: true }
  ]
  const select = (id: string) => {
    const handlers: Record<string, () => void> = {
      up: actions.moveUp,
      down: actions.moveDown,
      duplicate: actions.duplicate,
      other: actions.moveToOtherStage,
      delete: actions.remove
    }
    handlers[id]?.()
  }

  return (
    <div
      data-step-row
      {...drag.rowProps(index)}
      className={cn(
        'grid grid-cols-[16px_18px_minmax(0,1fr)_auto_auto_28px] items-center gap-2.5 rounded-lg border bg-nd-bg-primary py-1.5 pl-2 pr-1.5',
        drag.isDropTarget(index) ? 'border-nd-accent' : 'border-nd-border hover:border-nd-border-hover',
        drag.isDragging(index) && 'opacity-50'
      )}
    >
      <span {...drag.handleProps(index)} title="Drag to reorder" className="cursor-grab text-nd-text-muted active:cursor-grabbing">
        <GripVertical size={14} />
      </span>
      <span className="font-mono text-2xs text-nd-text-muted">{index + 1}</span>
      <div className="flex min-w-0 items-center gap-2">
        <input
          aria-label={`${label} command ${index + 1}`}
          className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 font-mono text-[12.5px] text-nd-text-primary placeholder:text-nd-text-muted hover:bg-nd-surface focus:bg-nd-surface focus:outline-none focus:ring-1 focus:ring-nd-accent"
          value={step.command}
          placeholder="php artisan migrate --force"
          spellCheck={false}
          autoFocus={step.command === ''}
          title={step.command}
          onChange={(e) => actions.change({ command: e.target.value })}
        />
        {flag && <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-2xs font-medium', FLAG_TONES[flag.tone])}>{flag.label}</span>}
      </div>
      <ModeSwitch optional={step.optional} onChange={(optional) => actions.change({ optional })} />
      <LimitField seconds={step.timeoutSeconds} onChange={(timeoutSeconds) => actions.change({ timeoutSeconds })} />
      <Dropdown
        align="right"
        items={menuItems}
        onSelect={select}
        trigger={
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Command options">
            <MoreHorizontal size={15} />
          </Button>
        }
      />
    </div>
  )
}
