import { Info, ShieldOff } from 'lucide-react'
import type { NginxNotice as NginxNoticeData } from '@/utils/ssl/header'

export function PartialNotice({ notice }: { notice: NginxNoticeData }) {
  return (
    <div role="status" className="flex items-center gap-3 rounded-[10px] border border-nd-warning/30 bg-nd-warning/[0.07] px-3.5 py-2.5 text-[13px] text-nd-text-secondary">
      <Info size={15} className="shrink-0 text-nd-warning-fg" />
      {notice.text}
    </div>
  )
}

export function EmptyHostnames({ notice }: { notice: NginxNoticeData | null }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <ShieldOff size={28} className="text-nd-text-muted" />
      <div className="text-sm text-nd-text-primary">{notice?.kind === 'missing' ? 'No nginx on this server' : 'No hostnames found'}</div>
      <div className="max-w-sm text-xs text-nd-text-muted">
        {notice?.text ?? 'nginx has no server blocks with a server_name, so there is nothing to check.'}
      </div>
    </div>
  )
}
