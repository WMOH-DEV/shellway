import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { CriticalBanner as CriticalBannerData } from '@/utils/ssl/banner'

export function CriticalBanner({ banner, onFix }: { banner: CriticalBannerData; onFix: (host: string) => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[10px] border border-nd-error/30 bg-nd-error/10 px-3.5 py-3">
      <AlertTriangle size={16} className="shrink-0 text-nd-error" />
      <span className="text-[13px] text-nd-text-secondary">
        <b className="font-semibold text-nd-text-primary">{banner.title}</b>
        {banner.detail && ` ${banner.detail}`}
      </span>
      <div className="flex-1" />
      <Button size="sm" onClick={() => onFix(banner.host)}>Fix {banner.host}</Button>
    </div>
  )
}
