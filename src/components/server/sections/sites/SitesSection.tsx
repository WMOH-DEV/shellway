import { useEffect, useState, type ReactNode } from 'react'
import { PageSpinner } from '@/components/ui/Spinner'
import { CreateSiteWizard } from '@/components/deploy/createSite/CreateSiteWizard'
import { KeySetup } from '@/components/deploy/KeySetup'
import { SetupWizard } from '@/components/deploy/setup/SetupWizard'
import { ShipPreview } from '@/components/deploy/ShipPreview'
import { toast } from '@/components/ui/Toast'
import { createPrefill } from '@/utils/server/sites/prefill'
import { Notice, SectionPage } from '../../kit'
import type { ServerSectionContext } from '../types'
import { siteRoute, sitesRoute } from './routes'
import { SiteDetailPage } from './SiteDetailPage'
import { SitesListPage } from './SitesListPage'
import { SSL_PAGES, SslPages } from './SslPages'
import { useCreateRuns, type CreateRuns } from './useCreateRuns'
import { findEntry, useSitesData, type SitesData } from './useSitesData'

interface PageProps {
  ctx: ServerSectionContext
  data: SitesData
  createRuns: CreateRuns
  onShip: (name: string) => void
}

function Missing({ ctx, what }: { ctx: ServerSectionContext; what: string }) {
  return (
    <SectionPage>
      <Notice tone="neutral" title={`${what} is not on this server`} action={<button type="button" className="text-[13px] text-nd-accent hover:underline" onClick={() => ctx.navigate(sitesRoute())}>Back to sites</button>}>
        It may have been removed. Refresh the site list to check again.
      </Notice>
    </SectionPage>
  )
}

function CreatePage({ ctx, data, createRuns }: PageProps) {
  const runId = ctx.route.params?.run
  const openDelete = ctx.route.params?.delete === '1' && createRuns.loaded
  useEffect(() => {
    if (openDelete && runId) ctx.navigate({ section: 'sites', sub: 'create', params: { run: runId } })
  }, [openDelete, runId, ctx])
  if (runId && !createRuns.loaded) return <PageSpinner />
  const close = () => {
    void data.deploy.refresh()
    void data.ssl.refresh()
    void createRuns.refresh()
    ctx.navigate(sitesRoute())
  }
  return (
    <CreateSiteWizard
      key={runId ?? 'new'}
      connectionId={data.connectionId}
      sessionId={data.sessionId}
      serverName={data.serverName}
      initialRun={createRuns.runs.find((run) => run.id === runId) ?? null}
      openDelete={openDelete}
      prefill={createPrefill(ctx.route.params)}
      onClose={close}
    />
  )
}

function SitePages({ ctx, data, createRuns, onShip }: PageProps) {
  const name = ctx.route.params?.site
  const entry = findEntry(data, name)
  if (ctx.route.sub === 'add') {
    return (
      <SetupWizard
        connectionId={data.connectionId}
        existingNames={data.deploy.sites.map((s) => s.config.name)}
        onCancel={() => ctx.navigate(sitesRoute())}
        onSiteSaved={() => void data.deploy.refresh()}
        onFinished={(site) => {
          toast.info(`Deploying ${site.name}…`)
          void data.deploy.refresh()
          ctx.navigate(siteRoute(site.name))
        }}
      />
    )
  }
  if (!entry) return data.deploy.runner === null || data.deploy.loading ? <PageSpinner /> : <Missing ctx={ctx} what={name ?? 'This site'} />
  if (ctx.route.sub === 'key') {
    return <KeySetup connectionId={data.connectionId} site={entry.summary.config} onDone={() => ctx.navigate(siteRoute(entry.summary.config.name))} />
  }
  return <SiteDetailPage key={entry.summary.config.name} ctx={ctx} data={data} entry={entry} createRuns={createRuns} onShip={onShip} />
}

function Page(props: PageProps) {
  const { sub } = props.ctx.route
  if (sub === 'create') return <CreatePage {...props} />
  if (sub && SSL_PAGES.has(sub)) return <SslPages ctx={props.ctx} data={props.data} createRuns={props.createRuns} />
  if (sub === 'site' || sub === 'add' || sub === 'key') return <SitePages {...props} />
  return <SitesListPage ctx={props.ctx} data={props.data} unfinished={props.createRuns.unfinished} onShip={props.onShip} />
}

export function SitesSection({ ctx }: { ctx: ServerSectionContext }) {
  const connected = ctx.connectionStatus === 'connected'
  const data = useSitesData(ctx)
  const createRuns = useCreateRuns(ctx.sessionId, connected)
  const [shipping, setShipping] = useState<string | null>(null)
  const shipSite = findEntry(data, shipping ?? undefined)?.summary

  if (!connected) {
    return <div className="flex h-full items-center justify-center text-sm text-nd-text-muted">Connect to this server to manage its sites</div>
  }

  const frame = (content: ReactNode) => (
    <div className="h-full">
      {content}
      {shipSite && (
        <ShipPreview
          connectionId={ctx.connectionId}
          summary={shipSite}
          open
          onClose={() => setShipping(null)}
          onDeploy={(options) => data.actions.deployNow(shipSite.config.name, options)}
          onApprove={() => data.actions.approve(shipSite.config.name)}
          onEditPipeline={() => {
            setShipping(null)
            ctx.navigate(siteRoute(shipSite.config.name, 'pipeline'))
          }}
        />
      )}
    </div>
  )

  return frame(<Page ctx={ctx} data={data} createRuns={createRuns} onShip={setShipping} />)
}
