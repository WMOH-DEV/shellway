import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { CloudflareStatus } from '@/types/ssl'
import { cloudflareButton } from '@/utils/ssl/header'
import { TONE_FILL } from './tones'

interface HostnamesHeaderProps {
  subtitle: string
  cloudflare: CloudflareStatus
  loading: boolean
  onRefresh: () => void
  onOpenSettings: () => void
  onAddHttps: () => void
}

export function HostnamesHeader({ subtitle, cloudflare, loading, onRefresh, onOpenSettings, onAddHttps }: HostnamesHeaderProps) {
  const status = cloudflareButton(cloudflare)
  return (
    <header className="flex flex-wrap items-center gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-lg font-semibold tracking-tight text-nd-text-primary">SSL</h1>
        <p className="truncate text-[13px] text-nd-text-muted">{subtitle}</p>
      </div>
      <div className="flex-1" />
      <Button onClick={onOpenSettings}>
        <span className={`h-[7px] w-[7px] rounded-full ${TONE_FILL[status.tone]}`} />
        {status.label}
      </Button>
      <Button onClick={onRefresh} disabled={loading}>
        <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Refresh
      </Button>
      <Button variant="primary" onClick={onAddHttps}>
        <Plus size={14} /> Add HTTPS
      </Button>
    </header>
  )
}
