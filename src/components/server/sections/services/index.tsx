import { Cog } from 'lucide-react'
import type { SectionModule, ServerSectionContext } from '../types'
import { ServerLogsPage } from './ServerLogsPage'
import { ServicesPage } from './ServicesPage'

function ServicesSection({ ctx }: { ctx: ServerSectionContext }) {
  return ctx.route.sub === 'logs' ? <ServerLogsPage ctx={ctx} /> : <ServicesPage ctx={ctx} />
}

export const servicesSection: SectionModule = {
  id: 'services',
  label: 'Services',
  icon: Cog,
  placement: 'main',
  Component: ServicesSection
}
