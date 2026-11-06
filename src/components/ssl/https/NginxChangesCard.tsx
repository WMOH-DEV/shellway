import type { IssueRequest } from '@/types/ssl'
import { nginxChangeLines } from '@/utils/ssl/addHttps/issueView'
import { Card } from '../Card'

interface NginxChangesCardProps {
  fileName: string
  request: IssueRequest
}

export function NginxChangesCard({ fileName, request }: NginxChangesCardProps) {
  const lines = nginxChangeLines(request)
  return (
    <Card label={`What certbot changes in ${fileName}`} ariaLabel="nginx changes" aside={<span className="text-xs text-nd-success-fg">+{lines.length}</span>}>
      <div className="flex flex-col rounded-lg bg-nd-bg-sunken py-2 font-mono text-[11.5px] leading-[1.75]">
        {lines.map((line) => (
          <span key={line} className="break-all bg-nd-success/10 px-3 text-nd-success-fg">+ {line}</span>
        ))}
      </div>
      {request.redirect && <span className="text-xs text-nd-text-secondary">Plus a small server block that redirects port 80 to HTTPS.</span>}
      <span className="text-xs text-nd-text-muted">
        The file is backed up to <span className="font-mono">/etc/ssl/shellway/backups/</span> first and restored if <span className="font-mono">nginx -t</span> fails.
      </span>
    </Card>
  )
}
