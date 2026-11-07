import { Check, Loader2, X } from 'lucide-react'
import type { ActionLaunch } from '@/stores/serverActionStore'

function pillContent(launch: ActionLaunch) {
  if (launch.phase === 'running') return { icon: <Loader2 size={14} className="animate-spin text-nd-accent" />, text: '1 action running' }
  if (launch.run?.status === 'done') return { icon: <Check size={14} className="text-nd-success-fg" />, text: 'Action finished' }
  return { icon: <X size={14} className="text-nd-error-fg" />, text: launch.run?.status === 'stopped' ? 'Action stopped' : 'Action failed' }
}

export function ActionPill({ launch, onOpen }: { launch: ActionLaunch; onOpen(): void }) {
  const { icon, text } = pillContent(launch)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${text}, show details`}
      className="fixed bottom-10 right-6 z-40 inline-flex h-8 items-center gap-2 rounded-[10px] border border-nd-border-hover bg-nd-surface-raised px-3 text-[13px] font-medium text-nd-text-primary shadow-2xl hover:bg-nd-surface-hover"
    >
      {icon}
      {text}
    </button>
  )
}
