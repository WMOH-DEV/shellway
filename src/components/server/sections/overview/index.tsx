import { LayoutDashboard } from 'lucide-react'
import type { SectionModule, ServerSectionContext } from '../types'
import { DiskPage } from './DiskPage'
import { MetricsPage } from './MetricsPage'
import { OverviewPage } from './OverviewPage'

function OverviewSection({ ctx }: { ctx: ServerSectionContext }) {
  if (ctx.route.sub === 'metrics') return <MetricsPage ctx={ctx} />
  if (ctx.route.sub === 'disk') return <DiskPage ctx={ctx} />
  return <OverviewPage ctx={ctx} />
}

export const overviewSection: SectionModule = {
  id: 'overview',
  label: 'Overview',
  icon: LayoutDashboard,
  placement: 'main',
  Component: OverviewSection
}
