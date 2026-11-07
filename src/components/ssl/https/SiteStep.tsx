import type { SslReport } from '@/types/ssl'
import { certbotLikelyFails } from '@/utils/ssl/addHttps/issuerAdvice'
import { fileName } from '@/utils/ssl/addHttps/siteOptions'
import type { AddHttpsFlow } from './useAddHttpsFlow'
import { IssuerCards } from './IssuerCards'
import { NamesCard } from './NamesCard'
import { SitePicker } from './SitePicker'
import { StepHeading } from './StepHeading'

export function SiteStep({ flow, report }: { flow: AddHttpsFlow; report: SslReport }) {
  const { site, prepare } = flow
  return (
    <div className="flex flex-col gap-[18px]">
      <StepHeading title="Site and certificate" subtitle="Pick the site, check its names are ready, choose who issues the certificate." />
      <SitePicker site={site} serverLabel={flow.issue.driver.label} />
      {site.block && <NamesCard site={site} fileName={fileName(site.block.file)} />}
      <IssuerCards
        certbotMissing={prepare.facts !== null && !prepare.ready}
        certbotLikelyFails={certbotLikelyFails(site.selected, site.readiness.data ?? [], report.hostnames)}
      />
    </div>
  )
}
