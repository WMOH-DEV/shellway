import { AlertTriangle } from 'lucide-react'

export function BlockedNotice({ reason }: { reason: string }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-[10px] border border-nd-warning/30 bg-nd-warning/[0.07] px-3.5 py-3 text-[13px] text-nd-text-secondary">
      <AlertTriangle size={15} className="mt-px shrink-0 text-nd-warning-fg" aria-hidden />
      <span>{reason}</span>
    </div>
  )
}
