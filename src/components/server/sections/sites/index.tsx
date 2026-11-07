import { lazy, Suspense } from 'react'
import { Globe } from 'lucide-react'
import type { SectionModule, ServerSectionContext } from '../types'

const DeployView = lazy(() => import('@/components/deploy/DeployView').then((m) => ({ default: m.DeployView })))
const SslView = lazy(() => import('@/components/ssl/SslView').then((m) => ({ default: m.SslView })))

function SitesSection({ ctx }: { ctx: ServerSectionContext }) {
  const View = ctx.route.sub === 'https' ? SslView : DeployView
  return (
    <Suspense fallback={null}>
      <View connectionId={ctx.connectionId} sessionId={ctx.sessionId} connectionStatus={ctx.connectionStatus} />
    </Suspense>
  )
}

export const sitesSection: SectionModule = {
  id: 'sites',
  label: 'Sites',
  icon: Globe,
  placement: 'main',
  Component: SitesSection
}
