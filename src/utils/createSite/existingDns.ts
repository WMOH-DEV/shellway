import type { CreateSiteInput, DnsRecordPlan, ExistingDnsRecord } from '@/types/createSite'
import { isIpv4 } from '../server/security/validate'
import { dnsRecords } from './plan'
import { siteNames } from './templates/shared'

export interface ExistingDns {
  kept: ExistingDnsRecord[]
  blocking: ExistingDnsRecord[]
}

export const matchesPlan = (found: Pick<ExistingDnsRecord, 'type' | 'content'>, planned: DnsRecordPlan): boolean =>
  found.type === planned.type && found.content.toLowerCase() === planned.content.toLowerCase()

export function existingDnsOf(records: ExistingDnsRecord[], site: Pick<CreateSiteInput, 'domain' | 'includeWww'>, serverIp: string | null): ExistingDns {
  const names = siteNames(site).map((name) => name.toLowerCase())
  const planned = serverIp !== null && isIpv4(serverIp) ? dnsRecords(site, serverIp, false) : []
  const relevant = records.filter((record) => names.includes(record.name.toLowerCase()))
  const fits = (record: ExistingDnsRecord): boolean => planned.some((plan) => plan.name.toLowerCase() === record.name.toLowerCase() && matchesPlan(record, plan))
  return { kept: relevant.filter(fits), blocking: relevant.filter((record) => !fits(record)) }
}
