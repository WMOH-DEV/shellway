import { PageHeader, SectionPage } from '../../kit'
import type { ServerSectionContext } from '../types'
import { CloudflareTokenCard, GithubCard } from './AccountCards'
import { CLOUDFLARE_SUB, CLOUDFLARE_ZONE_SUB, CloudflareSettings } from './CloudflareSettings'
import { NotificationsCard } from './NotificationsCard'
import { ServerPrefsCard } from './ServerPrefsCard'

const COLUMNS = { gridTemplateColumns: 'repeat(auto-fit, minmax(min(440px, 100%), 1fr))' }

export function SettingsSection({ ctx }: { ctx: ServerSectionContext }) {
  if (ctx.route.sub === CLOUDFLARE_SUB || ctx.route.sub === CLOUDFLARE_ZONE_SUB) return <CloudflareSettings ctx={ctx} />
  return (
    <SectionPage>
      <PageHeader title="Server settings" subtitle="Accounts, notifications and defaults. Everything here is stored on this PC." />
      <div className="grid items-start gap-4" style={COLUMNS}>
        <div className="flex flex-col gap-4">
          <ServerPrefsCard sessionId={ctx.sessionId} sessionName={ctx.sessionName} />
          <NotificationsCard />
        </div>
        <div className="flex flex-col gap-4">
          <CloudflareTokenCard onOpen={() => ctx.navigate({ section: 'settings', sub: CLOUDFLARE_SUB })} />
          <GithubCard />
        </div>
      </div>
    </SectionPage>
  )
}
