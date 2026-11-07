import { useMemo } from 'react'
import { useDeployActions, type DeployActions } from '@/components/deploy/useDeployActions'
import { useDeploySites, type DeploySites } from '@/components/deploy/useDeploySites'
import { useNowSeconds } from '@/components/ssl/useNowSeconds'
import { useSslReport, type SslReportState } from '@/components/ssl/useSslReport'
import { useSessionStore } from '@/stores/sessionStore'
import { INVENTORY_PROBE, inventoryFrom } from '@/utils/server/sites/inventory'
import { joinSites, type SiteEntry, type SitesJoin } from '@/utils/server/sites/join'
import type { SitesInventory } from '@/utils/server/sites/types'
import { useServerFacts, type FactsState } from '../../useServerFacts'
import type { ServerSectionContext } from '../types'

export interface SitesData {
  connectionId: string
  sessionId: string
  serverName: string
  user: string
  now: number
  deploy: DeploySites
  ssl: SslReportState
  facts: FactsState
  inventory: SitesInventory | null
  join: SitesJoin
  actions: DeployActions
  refreshAll: () => void
}

const PROBES = [INVENTORY_PROBE]

export function useSitesData(ctx: ServerSectionContext): SitesData {
  const connected = ctx.connectionStatus === 'connected'
  const deploy = useDeploySites(ctx.connectionId, ctx.sessionId, connected)
  const ssl = useSslReport(ctx.connectionId, ctx.sessionId, connected)
  const facts = useServerFacts(ctx, PROBES)
  const actions = useDeployActions(ctx.connectionId, deploy.refresh)
  const now = useNowSeconds()
  const user = useSessionStore((s) => s.sessions.find((x) => x.id === ctx.sessionId)?.username ?? '')
  const join = useMemo(() => joinSites(deploy.sites, ssl.report), [deploy.sites, ssl.report])
  const refreshAll = () => {
    void deploy.refresh()
    void ssl.refresh()
    void facts.refresh()
  }
  return {
    connectionId: ctx.connectionId,
    sessionId: ctx.sessionId,
    serverName: ctx.sessionName || 'this server',
    user,
    now,
    deploy,
    ssl,
    facts,
    inventory: inventoryFrom(facts.facts),
    join,
    actions,
    refreshAll
  }
}

export const findEntry = (data: SitesData, name: string | undefined): SiteEntry | undefined =>
  data.join.sites.find((entry) => entry.summary.config.name === name)
