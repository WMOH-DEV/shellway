import { Cloud } from 'lucide-react'
import type { WeakSslHost } from '@/utils/ssl/addHttps/issueView'
import { CLOUDFLARE_ORANGE } from '../tones'
import { Card } from '../Card'

export function CloudflareNote({ hosts }: { hosts: WeakSslHost[] }) {
  const modes = [...new Set(hosts.map((host) => host.mode))].join(' and ')
  return (
    <Card label="Cloudflare" ariaLabel="Cloudflare" aside={<Cloud size={16} style={{ color: CLOUDFLARE_ORANGE }} aria-hidden />}>
      <span className="text-[13px] text-nd-text-secondary">
        {hosts.map((host) => host.name).join(', ')} {hosts.length === 1 ? 'is' : 'are'} proxied and the zone's SSL mode is {modes}. The site keeps working while the certificate is added.
      </span>
      <span className="text-xs text-nd-text-muted">
        Afterwards you can switch the zone to Full (strict), so Cloudflare checks this certificate too.
      </span>
    </Card>
  )
}
