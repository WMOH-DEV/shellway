import { Cloud } from 'lucide-react'
import { cn } from '@/utils/cn'
import { CLOUDFLARE_ORANGE, TONE_CARD } from '../tones'

export function OrangeCloudCard() {
  return (
    <section aria-label="Keep the orange cloud on" className={cn('mt-auto flex flex-col gap-2 rounded-[10px] border p-3.5', TONE_CARD.warning)}>
      <span className="flex items-center gap-2 text-[13px] font-semibold text-nd-text-primary">
        <Cloud size={15} style={{ color: CLOUDFLARE_ORANGE }} aria-hidden /> Keep the orange cloud on
      </span>
      <span className="text-[12.5px] text-nd-text-secondary">Only Cloudflare trusts this certificate. If you set the record to DNS only, visitors get a certificate error.</span>
      <span className="text-xs text-nd-text-muted">Shellway will flag this hostname as Broken now if that happens.</span>
    </section>
  )
}
