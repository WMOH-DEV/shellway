import { useCallback, useEffect, useMemo, useRef } from 'react'
import { cn } from '@/utils/cn'
import { TabActiveContext } from '@/components/tabActive'
import { followFeatureRoutes, useServerNavStore, useServerRoute } from '@/stores/serverNavStore'
import type { AttentionItem, ServerRoute, ServerSection } from '@/types/server/core'
import type { ConnectionTab } from '@/types/session'
import { ActionHost } from './action'
import { ServerAttentionContext } from './attentionContext'
import { useSitesAttention } from './sections/sites/useSitesAttention'
import { mergeSitesAttention } from './useServerAttention'
import { sectionById } from './sections/registry'
import type { ServerSectionContext } from './sections/types'
import { ServerSubNav } from './shell/ServerSubNav'
import { isSidebarCollapsed, useServerSidebarStore } from './shell/sidebarStore'
import { useIsNarrow } from './shell/useIsNarrow'

const COLLAPSE_BELOW = 1100

interface ServerViewProps {
  tab: ConnectionTab
  active: boolean
  attention: readonly AttentionItem[]
}

function useLastSitesRoute(route: ServerRoute): ServerRoute | null {
  const last = useRef<ServerRoute | null>(null)
  if (route.section === 'sites') last.current = route
  return last.current
}

function SectionPanel({ ctx }: { ctx: ServerSectionContext }) {
  const { Component } = sectionById(ctx.route.section)
  return <Component ctx={ctx} />
}

export function ServerView({ tab, active, attention }: ServerViewProps) {
  const route = useServerRoute(tab.id)
  const navigateTo = useServerNavStore((state) => state.navigate)
  const rootRef = useRef<HTMLDivElement>(null)
  const narrow = useIsNarrow(rootRef, COLLAPSE_BELOW)
  const { choice, setChoice } = useServerSidebarStore()
  const collapsed = isSidebarCollapsed(choice, narrow)
  const sitesRoute = useLastSitesRoute(route)
  const sitesItems = useSitesAttention({ connectionId: tab.id, sessionId: tab.sessionId, connectionStatus: active ? tab.status : 'disconnected' })
  const items = useMemo(() => mergeSitesAttention(attention, sitesItems), [attention, sitesItems])
  const onSites = route.section === 'sites'

  useEffect(() => followFeatureRoutes(), [])

  const navigate = useCallback((next: ServerRoute) => navigateTo(tab.id, next), [navigateTo, tab.id])
  const selectSection = useCallback((section: ServerSection) => navigate({ section }), [navigate])

  const contextFor = useCallback((sectionRoute: ServerRoute, sectionActive: boolean): ServerSectionContext => ({
    tabId: tab.id,
    connectionId: tab.id,
    sessionId: tab.sessionId,
    sessionName: tab.sessionName,
    connectionStatus: tab.status,
    route: sectionRoute,
    active: sectionActive,
    navigate
  }), [tab.id, tab.sessionId, tab.sessionName, tab.status, navigate])

  const sitesCtx = useMemo(() => sitesRoute && contextFor(sitesRoute, active && onSites), [sitesRoute, contextFor, active, onSites])
  const sectionCtx = useMemo(() => contextFor(route, true), [contextFor, route])

  return (
    <ServerAttentionContext.Provider value={items}>
    <div ref={rootRef} className="flex h-full min-h-0 bg-nd-bg-primary">
      <ServerSubNav
        connectionId={tab.id}
        active={active}
        name={tab.sessionName}
        status={tab.status}
        section={route.section}
        attention={items}
        collapsed={collapsed}
        onSelect={selectSection}
        onToggleCollapsed={() => setChoice(collapsed ? 'expanded' : 'collapsed')}
      />
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {sitesCtx && (
          <div className={cn('absolute inset-0 flex flex-col overflow-auto', !onSites && 'hidden')}>
            <TabActiveContext.Provider value={sitesCtx.active}>
              <SectionPanel ctx={sitesCtx} />
            </TabActiveContext.Provider>
          </div>
        )}
        {active && !onSites && (
          <div className="absolute inset-0 flex flex-col overflow-auto">
            <SectionPanel key={route.section} ctx={sectionCtx} />
          </div>
        )}
      </div>
      <ActionHost tabId={tab.id} connectionId={tab.id} sessionKey={tab.sessionId} />
    </div>
    </ServerAttentionContext.Provider>
  )
}
