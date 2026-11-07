import { lazy, Suspense } from 'react'
import { LayoutDashboard } from 'lucide-react'
import { ConnectionHealthDashboard } from '@/components/connection/ConnectionHealthDashboard'
import type { SectionModule, ServerSectionContext } from '../types'

const MonitorView = lazy(() => import('@/components/monitor/MonitorView').then((m) => ({ default: m.MonitorView })))

function OverviewSection({ ctx }: { ctx: ServerSectionContext }) {
  if (ctx.route.sub === 'metrics') {
    return (
      <Suspense fallback={null}>
        <MonitorView connectionId={ctx.connectionId} sessionId={ctx.sessionId} connectionStatus={ctx.connectionStatus} />
      </Suspense>
    )
  }
  return <ConnectionHealthDashboard connectionId={ctx.connectionId} sessionName={ctx.sessionName} status={ctx.connectionStatus} />
}

export const overviewSection: SectionModule = {
  id: 'overview',
  label: 'Overview',
  icon: LayoutDashboard,
  placement: 'main',
  Component: OverviewSection
}
