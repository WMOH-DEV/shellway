import { Cloud, Lock } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ssl/Card'
import { Option } from '@/components/ssl/https/IssueOptions'
import { StepHeading } from '@/components/ssl/https/StepHeading'
import type { CloudflareZoneRef, DnsInput, DnsRecordPlan } from '@/types/createSite'
import { dnsRecords } from '@/utils/createSite/plan'
import { isValidEmail } from '@/utils/ssl/https/issueCommands'
import { RecordRows } from './RecordRows'
import type { CreateSiteDraftModel } from './useCreateSiteDraft'

interface DomainStepProps {
  model: CreateSiteDraftModel
  zone: CloudflareZoneRef | null
  dns: DnsInput | null
}

function manualReason(zone: CloudflareZoneRef | null, domain: string): string {
  if (zone === null) return `No Cloudflare zone for ${domain}. Create this record at your DNS provider before the run reaches the DNS step.`
  return `Your Cloudflare token cannot create DNS records. Add the Zone → DNS → Edit permission in SSL settings, or create this record by hand.`
}

function plannedRecords(draft: CreateSiteDraftModel['draft'], dns: DnsInput): DnsRecordPlan[] | string {
  try {
    return dnsRecords(draft, dns.serverIp, dns.proxied)
  } catch (err) {
    return (err as Error).message
  }
}

function DnsBody({ model, zone, dns }: DomainStepProps) {
  const { draft } = model
  if (dns === null) {
    return <span className="text-[13px] text-nd-text-secondary">Shellway could not find this server's public IPv4 address. Point {draft.domain} at this server at your DNS provider before the run reaches the DNS step.</span>
  }
  const records = plannedRecords(draft, dns)
  if (typeof records === 'string') return <span className="text-[13px] text-nd-error-fg">{records}</span>
  if (dns.zoneId === null) {
    return (
      <>
        <span className="text-[13px] text-nd-text-secondary">{manualReason(zone, draft.domain)}</span>
        <RecordRows records={records} />
      </>
    )
  }
  return (
    <>
      <span className="text-[13px] text-nd-text-secondary">Created in Cloudflare zone <span className="font-mono">{dns.zoneName}</span> with your token. Nothing else in the zone changes.</span>
      <RecordRows records={records} />
      <Option checked={draft.proxied} onChange={(proxied) => model.patch({ proxied })} disabled={false} label="Proxy through Cloudflare" note="Visitors reach Cloudflare first. Turn off for DNS only." />
    </>
  )
}

function HttpsCard({ model }: Pick<DomainStepProps, 'model'>) {
  const { draft } = model
  const email = draft.email.trim()
  return (
    <Card label="HTTPS" ariaLabel="HTTPS" aside={<span className="flex items-center gap-1.5 text-xs text-nd-text-muted"><Lock size={13} aria-hidden />Let's Encrypt via certbot</span>}>
      <div className="flex flex-wrap items-start gap-x-7 gap-y-4">
        <div className="min-w-[260px] flex-1">
          <Input
            label="Email for Let's Encrypt"
            type="email"
            autoComplete="email"
            spellCheck={false}
            placeholder="admin@example.com"
            value={draft.email}
            error={email !== '' && !isValidEmail(email) ? 'Enter a valid email address' : undefined}
            onChange={(e) => model.setEmail(e.target.value)}
          />
          <span className="mt-1 block text-xs text-nd-text-muted">Needed for the account. Remembered for next time.</span>
        </div>
        <div className="flex min-w-[260px] flex-1 flex-col gap-3">
          <Option checked={draft.redirect} onChange={(redirect) => model.patch({ redirect })} disabled={false} label="Redirect HTTP to HTTPS" note="Visitors on http:// are sent to https://" />
          <Option checked={draft.staging} onChange={(staging) => model.patch({ staging })} disabled={false} label="Test with staging first" note="If the test fails, nothing real is requested" />
        </div>
      </div>
    </Card>
  )
}

export function DomainStep(props: DomainStepProps) {
  return (
    <div className="flex flex-col gap-5">
      <StepHeading title="Domain and HTTPS" subtitle="The DNS record that points the name at this server, and the certificate for it." />
      <Card label="DNS record" ariaLabel="DNS record" aside={<Cloud size={16} className="text-nd-cloudflare" aria-hidden />}>
        <DnsBody {...props} />
      </Card>
      <HttpsCard model={props.model} />
    </div>
  )
}
