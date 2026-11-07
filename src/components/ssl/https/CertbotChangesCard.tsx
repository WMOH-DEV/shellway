import type { IssueRequest } from '@/types/ssl'
import { certbotChanges } from '@/utils/ssl/addHttps/issueView'
import { fileName } from '@/utils/ssl/addHttps/siteOptions'
import type { WebServerDriver } from '@/utils/webServer'
import { Card } from '../Card'

interface CertbotChangesCardProps {
  siteFile: string
  request: IssueRequest
  driver: WebServerDriver
}

export function CertbotChangesCard({ siteFile, request, driver }: CertbotChangesCardProps) {
  const changes = certbotChanges(request, siteFile, driver)
  const label = changes.newFile ? `What certbot adds in a new file, ${fileName(changes.file)}` : `What certbot changes in ${fileName(changes.file)}`
  return (
    <Card label={label} ariaLabel="certbot changes" aside={<span className="text-xs text-nd-success-fg">+{changes.lines.length}</span>}>
      <div className="flex flex-col rounded-lg bg-nd-bg-sunken py-2 font-mono text-[11.5px] leading-[1.75]">
        {changes.lines.map((line) => (
          <span key={line} className="break-all bg-nd-success/10 px-3 text-nd-success-fg">+ {line}</span>
        ))}
      </div>
      {request.redirect && <span className="text-xs text-nd-text-secondary">{changes.redirectNote}</span>}
      <span className="text-xs text-nd-text-muted">
        {fileName(siteFile)} is backed up to <span className="font-mono">/etc/ssl/shellway/backups/</span> first and restored if <span className="font-mono">{driver.testCommand}</span> fails{changes.newFile ? ', and the new file is removed' : ''}.
      </span>
    </Card>
  )
}
