import { lazy, Suspense } from 'react'
import { Globe } from 'lucide-react'
import type { SectionModule, ServerSectionContext } from '../types'

const SitesSection = lazy(() => import('./SitesSection').then((m) => ({ default: m.SitesSection })))

function LazySitesSection({ ctx }: { ctx: ServerSectionContext }) {
  return (
    <Suspense fallback={null}>
      <SitesSection ctx={ctx} />
    </Suspense>
  )
}

export const sitesSection: SectionModule = {
  id: 'sites',
  label: 'Sites',
  icon: Globe,
  placement: 'main',
  Component: LazySitesSection
}
