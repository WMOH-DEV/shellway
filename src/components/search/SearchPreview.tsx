import { useSearchCacheStore } from '@/search/cacheClient'
import type { ActionRole, SearchAction, SearchResult } from '@/search/types'
import { formatCombo } from '@/utils/keybindings'
import { cn } from '@/utils/cn'
import { describeResult } from './previewDetails'
import { RESULT_VISUALS } from './resultVisuals'

interface SearchPreviewProps {
  result: SearchResult | null
  actions: SearchAction[]
  onRun: (action: SearchAction) => void
}

const ROLE_ORDER: ActionRole[] = ['primary', 'secondary', 'copy', 'extra']

function roleHint(role: ActionRole): string | null {
  if (role === 'primary') return '↵'
  if (role === 'secondary') return formatCombo('CmdOrCtrl+Enter')
  if (role === 'copy') return formatCombo('CmdOrCtrl+C')
  return null
}

function sortActions(actions: SearchAction[]): SearchAction[] {
  return [...actions].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
}

export function SearchPreview({ result, actions, onRun }: SearchPreviewProps) {
  const snapshot = useSearchCacheStore((s) => s.snapshot)

  if (!result) {
    return <div className="flex flex-col gap-3 p-4 text-xs text-nd-text-muted">Select a result to see details.</div>
  }

  const { Icon, tone } = RESULT_VISUALS[result.icon]
  const body = describeResult(result, snapshot)

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-center gap-2.5">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-nd-surface', tone)}>
          <Icon size={16} />
        </span>
        <span className="flex min-w-0 flex-col">
          <b className="truncate text-sm font-semibold text-nd-text-primary">{result.title}</b>
          <span className="truncate text-xs text-nd-text-muted">{result.subtitle}</span>
        </span>
      </div>

      {body.kind === 'columns' && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-nd-text-muted">Columns</span>
          <ul className="max-h-40 overflow-y-auto font-mono text-[11.5px] leading-[1.8] text-nd-text-secondary">
            {body.columns.map((column) => (
              <li key={column}>{column}</li>
            ))}
          </ul>
        </div>
      )}
      {body.kind === 'code' && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-nd-border bg-nd-bg-sunken p-2.5 font-mono text-xs leading-relaxed text-nd-text-secondary">
          {body.text}
        </pre>
      )}
      {body.kind === 'text' && <span className="break-all font-mono text-xs text-nd-text-secondary">{body.text}</span>}

      <div className="flex-1" />

      <div className="flex flex-col gap-1.5">
        {sortActions(actions).map((action) => {
          const hint = roleHint(action.role)
          const isPrimary = action.role === 'primary'
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => onRun(action)}
              className={cn(
                'flex h-7 items-center justify-between rounded-md border px-2.5 text-xs font-medium transition-colors',
                isPrimary
                  ? 'border-nd-accent-solid bg-nd-accent-solid text-white hover:bg-nd-accent-solid-hover'
                  : 'border-nd-border bg-nd-surface text-nd-text-primary hover:bg-nd-surface-hover'
              )}
            >
              {action.label}
              {hint && (
                <kbd
                  className={cn(
                    'rounded border px-1 font-mono text-[10.5px]',
                    isPrimary ? 'border-white/30 text-white/80' : 'border-nd-border text-nd-text-muted'
                  )}
                >
                  {hint}
                </kbd>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
