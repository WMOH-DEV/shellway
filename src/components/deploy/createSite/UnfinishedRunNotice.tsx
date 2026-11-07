import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export function UnfinishedRunNotice({ domain, onOpen }: { domain: string; onOpen: () => void }) {
  return (
    <div role="status" className="flex items-center gap-3 rounded-[10px] border border-nd-warning/30 bg-nd-warning/[0.07] px-3.5 py-2.5">
      <AlertTriangle size={15} className="shrink-0 text-nd-warning-fg" aria-hidden />
      <span className="flex-1 text-[13px] text-nd-text-primary">A Create site run for {domain} did not finish.</span>
      <Button size="sm" onClick={onOpen}>Open</Button>
    </div>
  )
}
