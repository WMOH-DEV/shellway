import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PageHeader, SectionPage } from '../../kit'
import type { ServerSectionContext } from '../types'
import { Catalog } from './Catalog'
import { DetailPanel } from './DetailPanel'
import { PackageSearch } from './PackageSearch'
import { UpdatesBanner } from './UpdatesBanner'
import { useSoftware } from './useSoftware'

export function SoftwareSection({ ctx }: { ctx: ServerSectionContext }) {
  const state = useSoftware(ctx)
  const panel = ctx.route.sub ?? 'php'
  const refresh = (
    <Button size="icon" variant="ghost" aria-label="Refresh" disabled={state.loading} onClick={() => void state.refresh()}>
      <RefreshCw size={15} className={state.loading ? 'animate-spin' : undefined} />
    </Button>
  )
  return (
    <SectionPage>
      <PageHeader
        title="Software"
        subtitle="What's installed, what can be updated, and one-click installs that follow each project's official instructions."
        actions={<>{refresh}<PackageSearch connectionId={ctx.connectionId} run={state.run} /></>}
      />
      <UpdatesBanner state={state} />
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-start gap-4">
        <Catalog ctx={ctx} state={state} selected={panel} />
        <DetailPanel panel={panel} ctx={ctx} state={state} />
      </div>
    </SectionPage>
  )
}
