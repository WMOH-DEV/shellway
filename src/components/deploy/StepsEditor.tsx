import { useState } from 'react'
import { ChevronDown, ChevronUp, Plus, RotateCw, Trash2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import type { DeployStep } from '@/types/deploy'

interface StepsEditorProps {
  connectionId: string
  title: string
  hint: string
  steps: DeployStep[]
  onChange: (steps: DeployStep[]) => void
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function ServicePicker({ connectionId, onPick }: { connectionId: string; onPick: (unit: string) => void }) {
  const [units, setUnits] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setError(null)
    const result = await window.novadeck.services.list(connectionId)
    if (!result?.success) {
      setError(result?.error ?? 'Could not list services')
      return
    }
    setUnits((result.data as { unit: string }[]).map((s) => s.unit).sort())
  }

  if (error) {
    return (
      <span className="flex items-center gap-1 text-2xs text-nd-error-fg">
        {error}
        <Button size="sm" variant="ghost" onClick={() => void load()}>Try again</Button>
      </span>
    )
  }
  if (!units) {
    return (
      <Button size="sm" variant="ghost" onClick={() => void load()}>
        <RotateCw size={12} /> Add service restart
      </Button>
    )
  }
  return (
    <select
      className="h-7 rounded border border-nd-border-hover bg-nd-bg-sunken px-2 text-xs text-nd-text-primary"
      value=""
      onChange={(e) => e.target.value && onPick(e.target.value)}
    >
      <option value="" disabled>Restart which service?</option>
      {units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
    </select>
  )
}

export function StepsEditor({ connectionId, title, hint, steps, onChange }: StepsEditorProps) {
  const update = (index: number, patch: Partial<DeployStep>) =>
    onChange(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)))
  const add = (command = '') => onChange([...steps, { command, optional: false, timeoutSeconds: null }])

  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="text-xs font-medium text-nd-text-primary">{title}</div>
        <div className="text-2xs text-nd-text-muted">{hint}</div>
      </div>
      {steps.length === 0 && <div className="text-2xs text-nd-text-muted italic">No commands</div>}
      {steps.map((step, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <span className="w-5 text-right text-2xs text-nd-text-muted">{index + 1}</span>
          <input
            className="h-7 flex-1 rounded border border-nd-border-hover bg-nd-bg-sunken px-2 font-mono text-xs text-nd-text-primary focus:border-nd-accent focus:outline-none"
            value={step.command}
            placeholder="php artisan migrate --force"
            spellCheck={false}
            onChange={(e) => update(index, { command: e.target.value })}
          />
          <button
            type="button"
            title={step.optional ? 'If this fails, the deploy continues with a warning' : 'If this fails, the deploy stops'}
            className={cn(
              'h-7 w-20 rounded text-2xs font-medium transition-colors',
              step.optional
                ? 'bg-nd-warning/12 text-nd-warning-fg'
                : 'bg-nd-accent/12 text-nd-accent-hover'
            )}
            onClick={() => update(index, { optional: !step.optional })}
          >
            {step.optional ? 'Optional' : 'Required'}
          </button>
          <Button size="icon" variant="ghost" className="h-7 w-7" title="Move up" onClick={() => onChange(moveItem(steps, index, index - 1))}>
            <ChevronUp size={13} />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" title="Move down" onClick={() => onChange(moveItem(steps, index, index + 1))}>
            <ChevronDown size={13} />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" title="Remove" onClick={() => onChange(steps.filter((_, i) => i !== index))}>
            <Trash2 size={13} />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => add()}>
          <Plus size={12} /> Add command
        </Button>
        <ServicePicker connectionId={connectionId} onPick={(unit) => add(`sudo systemctl restart ${unit}`)} />
      </div>
    </div>
  )
}
