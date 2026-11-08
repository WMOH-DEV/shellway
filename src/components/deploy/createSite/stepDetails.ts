import type { DnsInput, SiteServer } from '@/types/createSite'
import { repoLabel } from '@/utils/deploy/siteDetail'
import { TEMPLATES } from '@/utils/createSite/templates'
import { WIZARD_STEPS, commandsOf, repoUrlOf, type CreateSiteDraft, type WizardStep } from '@/utils/createSite/wizard'
import { pluralize } from '@/utils/ssl/time'
import type { StepperStep } from './CreateSiteStepper'

const HINTS: Record<StepperStep, string> = {
  site: 'domain and code',
  stack: 'what the code is built with',
  commands: 'deploy commands, database, env',
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

function codeLabel(draft: CreateSiteDraft): string {
  if (draft.codeSource === 'none') return 'no code yet'
  const url = repoUrlOf(draft)
  if (draft.codeSource === 'new') return url === '' ? 'new project' : `new project in ${repoLabel(url)}`
  return url === '' ? '' : repoLabel(url)
}

function commandCount(draft: CreateSiteDraft, server: SiteServer): string {
  if (draft.codeSource === 'none') return 'no deploys'
  try {
    const { buildSteps, activateSteps } = commandsOf(draft, server)
    return pluralize(buildSteps.length + activateSteps.length, 'command')
  } catch {
    return HINTS.commands
  }
}

function summaries({ draft, server, dns, planSteps }: DetailFacts): Record<WizardStep, string> {
  return {
    site: draft.domain === '' ? HINTS.site : [draft.domain, codeLabel(draft)].filter(Boolean).join(' · '),
    stack: [TEMPLATES[draft.template].label, ...(server.kind === 'apache' ? ['Apache'] : [])].join(' · '),
    commands: commandCount(draft, server),
    domain: `${dnsLabel(dns)} · Let's Encrypt`,
    review: planSteps === null ? HINTS.review : `${planSteps} steps`
  }
}

export function stepDetails(current: WizardStep, facts: DetailFacts): Record<StepperStep, string> {
  const reached = WIZARD_STEPS.slice(0, WIZARD_STEPS.indexOf(current) + 1)
  const known = summaries(facts)
  return { ...HINTS, ...Object.fromEntries(reached.map((step) => [step, known[step]])) }
}
