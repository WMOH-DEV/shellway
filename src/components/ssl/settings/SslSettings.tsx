import type { SslReport } from '@/types/ssl'

export interface SslSettingsProps {
  connectionId: string
  report: SslReport | null
  onBack: () => void
  onRecheck: () => void
  onCloudflareChanged: () => void
}

export function SslSettings({ onBack }: SslSettingsProps) {
  return (
    <div className="flex h-full items-center justify-center bg-nd-bg-primary text-sm text-nd-text-muted">
      <button type="button" onClick={onBack}>Back</button>
    </div>
  )
}
