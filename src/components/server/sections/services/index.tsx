import { lazy, Suspense } from 'react'
import { Cog } from 'lucide-react'
import type { SectionModule, ServerSectionContext } from '../types'

const ServiceManagerView = lazy(() => import('@/components/services/ServiceManagerView').then((m) => ({ default: m.ServiceManagerView })))

function ServicesSection({ ctx }: { ctx: ServerSectionContext }) {
  return (
    <Suspense fallback={null}>
      <ServiceManagerView connectionId={ctx.connectionId} sessionId={ctx.sessionId} connectionStatus={ctx.connectionStatus} />
    </Suspense>
  )
}

export const servicesSection: SectionModule = {
  id: 'services',
  label: 'Services',
  icon: Cog,
  placement: 'main',
  Component: ServicesSection
}
