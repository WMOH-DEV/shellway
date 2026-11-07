import type { DnsInput, SiteServer } from '@/types/createSite'
import { repoLabel } from '@/utils/deploy/siteDetail'
import { TEMPLATES } from '@/utils/createSite/templates'
import { WIZARD_STEPS, type CreateSiteDraft, type WizardStep } from '@/utils/createSite/wizard'
import type { StepperStep } from './CreateSiteStepper'

const HINTS: Record<StepperStep, string> = {
  site: 'domain and template',
  code: 'repository, branch, auto deploy',
  domain: 'DNS record, certificate',
  review: 'every command, before it runs',
  create: 'runs step by step'
}

interface DetailFacts {
  draft: CreateSiteDraft
  server: SiteServer
  dns: DnsInput | null
  planSteps: number | null
}

function dnsLabel(dns: DnsInput | null): string {
  if (dns === null || dns.zoneId === null) return 'record by hand'
  return dns.proxied ? 'proxied' : 'DNS only'
}

function summaries({ draft, server, dns, planSteps }: DetailFacts): Record<WizardStep, string> {
  const site = [draft.domain, TEMPLATES[draft.template].label, ...(server.kind === 'apache' ? ['Apache'] : [])]
  return {
    site: draft.domain === '' ? HINTS.site : site.join(' · '),
    code: [repoLabel(draft.repoUrl), draft.branch, draft.sourceMode === 'auto' ? 'auto' : 'from my PC'].join(' · '),
    domain: `${dnsLabel(dns)} · Let's Encrypt`,
    review: planSteps === null ? HINTS.review : `${planSteps} steps`
  }
}

export function stepDetails(current: WizardStep, facts: DetailFacts): Record<StepperStep, string> {
  const reached = WIZARD_STEPS.slice(0, WIZARD_STEPS.indexOf(current) + 1)
  const known = summaries(facts)
  return { ...HINTS, ...Object.fromEntries(reached.map((step) => [step, known[step]])) }
}
