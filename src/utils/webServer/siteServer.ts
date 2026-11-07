import type { ServerFacts } from '../../types/ssl'

export type SiteServer = 'nginx' | 'apache'

type SiteServerFacts = Pick<ServerFacts, 'nginx' | 'apache' | 'serving'>

export const SITE_SERVER_LABELS: Record<SiteServer, string> = { nginx: 'nginx', apache: 'Apache' }

export function siteServer({ nginx, apache, serving }: SiteServerFacts): SiteServer | null {
  if (serving === 'apache' && apache) return 'apache'
  if (nginx) return 'nginx'
  return apache ? 'apache' : null
}

export function siteServerLabel(facts: SiteServerFacts): string | null {
  const kind = siteServer(facts)
  return kind ? SITE_SERVER_LABELS[kind] : null
}
