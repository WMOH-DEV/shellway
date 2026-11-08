import { weakSslHosts } from '@/utils/ssl/addHttps/issueView'
import type { SslReport } from '@/types/ssl'
import { CloudflareNote } from './CloudflareNote'
import { CommandsCard } from './CommandsCard'
import { IssueOptions } from './IssueOptions'
import { IssueResultPanel } from './IssueResultPanel'
import { CertbotChangesCard } from './CertbotChangesCard'
import { StepHeading } from './StepHeading'
import type { AddHttpsFlow } from './useAddHttpsFlow'

export function IssueStep({ flow, report }: { flow: AddHttpsFlow; report: SslReport }) {
  const { issue, site, prepare } = flow
  const weak = weakSslHosts(report.hostnames, site.selected)
  const version = prepare.facts?.certbot?.version
  const lastCommand = issue.rows?.[issue.rows.length - 1]?.command ?? ''
  return (
    <div className="flex flex-col gap-4">
      <StepHeading
        title="Review and issue"
        subtitle={`${version ? `certbot ${version}` : 'certbot'} is installed and renewal is scheduled. This is everything that will run.`}
      />
      <IssueOptions issue={issue} />
      <CommandsCard rows={issue.rows} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-4">
        {site.block && <CertbotChangesCard siteFile={site.block.file} request={issue.request} driver={issue.driver} />}
        {weak.length > 0 && <CloudflareNote hosts={weak} />}
      </div>
      <IssueResultPanel issue={issue} command={lastCommand} />
    </div>
  )
}
