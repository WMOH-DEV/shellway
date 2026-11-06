import { Check, Copy, Info } from 'lucide-react'
import { copyText } from '@/components/deploy/copyText'
import type { InstallPlan, InstallRoute, InstallStep } from '@/types/ssl'
import { cn } from '@/utils/cn'
import { manualCommands, planTag, ROUTE_LABELS } from '@/utils/ssl/addHttps/prepView'
import { CardLabel } from '../Card'

interface PlanCardProps {
  plan: InstallPlan
  manual: boolean
  fullSudo: boolean
  busy: boolean
  onRoute: (route: InstallRoute) => void
}

const TAG_STYLE: Record<InstallStep['status'], string> = {
  run: 'bg-nd-accent/[.12] text-nd-accent',
  skip: 'bg-nd-bg-tertiary text-nd-text-muted',
  check: 'bg-nd-success/[.12] text-nd-success'
}

function RouteToggle({ plan, busy, onRoute }: Pick<PlanCardProps, 'plan' | 'busy' | 'onRoute'>) {
  return (
    <div role="group" aria-label="Install route" className="flex gap-0.5 rounded-md border border-nd-border p-0.5">
      {plan.routes.map((route) => (
        <button
          key={route}
          type="button"
          aria-pressed={plan.route === route}
          disabled={busy}
          onClick={() => onRoute(route)}
          className={cn(
            'h-[26px] rounded px-2.5 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50',
            plan.route === route ? 'bg-nd-bg-tertiary text-nd-text-primary' : 'text-nd-text-muted hover:text-nd-text-primary'
          )}
        >
          {ROUTE_LABELS[route]}
        </button>
      ))}
    </div>
  )
}

function PlanRow({ step, index, manual }: { step: InstallStep; index: number; manual: boolean }) {
  const skipped = step.status === 'skip'
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-[9px]">
      <span className="text-right font-mono text-[11px] text-nd-text-muted">{index + 1}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className={cn('truncate font-mono text-[12.5px]', skipped ? 'text-nd-text-muted' : 'text-nd-text-primary')} title={step.command}>
          {manual ? `sudo ${step.command}` : step.command}
        </span>
        <span className="text-xs text-nd-text-muted">{step.why}</span>
      </div>
      <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', TAG_STYLE[step.status])}>{planTag(step)}</span>
    </li>
  )
}

function SudoNote({ fullSudo }: { fullSudo: boolean }) {
  const Icon = fullSudo ? Check : Info
  return (
    <span className="flex items-center gap-2 text-xs text-nd-text-muted">
      <Icon size={14} className={fullSudo ? 'text-nd-success' : 'text-nd-warning'} aria-hidden />
      {fullSudo
        ? 'Needs full passwordless sudo · available.'
        : 'Needs full passwordless sudo · not available. Run these commands by hand, then Check again.'}
    </span>
  )
}

export function PlanCard({ plan, manual, fullSudo, busy, onRoute }: PlanCardProps) {
  return (
    <section aria-label="Install plan" className="overflow-hidden rounded-[10px] border border-nd-border bg-nd-bg-secondary">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-nd-border px-4 py-3">
        <CardLabel>Install plan</CardLabel>
        <span className="text-xs text-nd-text-muted">{manual ? 'run these on the server, as root' : 'runs once, as root, output shown live'}</span>
        <div className="flex-1" />
        {plan.routes.length > 1 && <RouteToggle plan={plan} busy={busy} onRoute={onRoute} />}
      </div>
      <ol className="py-1.5">
        {plan.steps.map((step, index) => <PlanRow key={step.id} step={step} index={index} manual={manual} />)}
      </ol>
      <div className="flex items-center gap-2.5 border-t border-nd-border px-4 py-2.5">
        <SudoNote fullSudo={fullSudo} />
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void copyText(manualCommands(plan).join('\n'), 'Commands copied')}
          className="flex items-center gap-1 rounded text-xs text-nd-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent"
        >
          <Copy size={13} aria-hidden /> Copy all
        </button>
      </div>
    </section>
  )
}
