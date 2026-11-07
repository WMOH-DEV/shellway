import { lazy, Suspense } from 'react'
import { Spinner } from '@/components/ui/Spinner'
import { OVERVIEW_ROUTE } from '@/utils/server/overview/ids'
import type { ServerSectionContext } from '../types'
import { BackLink } from './BackLink'

const MonitorView = lazy(() => import('@/components/monitor/MonitorView').then((m) => ({ default: m.MonitorView })))

export function MetricsPage({ ctx }: { ctx: ServerSectionContext }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-7 pt-[18px]">
        <BackLink onBack={() => ctx.navigate(OVERVIEW_ROUTE)} />
      </div>
      <div className="min-h-0 flex-1">
        <Suspense fallback={<div className="flex justify-center py-10"><Spinner /></div>}>
          <MonitorView connectionId={ctx.connectionId} sessionId={ctx.sessionId} connectionStatus={ctx.connectionStatus} />
        </Suspense>
      </div>
    </div>
  )
}
