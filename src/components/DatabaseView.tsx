import { lazy, Suspense } from 'react'
import type { ConnectionTab } from '@/types/session'

const SQLView = lazy(() => import('@/components/sql/SQLView').then(m => ({ default: m.SQLView })))

interface DatabaseViewProps {
  tab: ConnectionTab
}

/**
 * Standalone database connection view — slim wrapper around SQLView.
 * Used for direct database connections (no SSH tunnel required).
 * The tab opens directly into the SQL client without Terminal/SFTP sub-tabs.
 */
export function DatabaseView({ tab }: DatabaseViewProps) {
  return (
    <div className="flex flex-col h-full">
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-full text-nd-text-muted text-sm">
            Loading SQL Client...
          </div>
        }
      >
        <SQLView connectionId={tab.id} sessionId={tab.sessionId} isStandalone />
      </Suspense>
    </div>
  )
}
