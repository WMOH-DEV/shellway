import { useEffect } from 'react'
import { listenForRuns, setDrawerOpen, useServerActionStore } from '@/stores/serverActionStore'
import { ActionDrawer } from './ActionDrawer'
import { ActionPill } from './ActionPill'
import type { ActionHostProps } from './types'

export function ActionHost({ tabId, sessionKey }: ActionHostProps) {
  const launch = useServerActionStore((state) => state.launches[tabId])
  useEffect(listenForRuns, [])
  if (!launch) return null
  if (!launch.open) return <ActionPill launch={launch} onOpen={() => setDrawerOpen(tabId, true)} />
  return <ActionDrawer tabId={tabId} sessionKey={sessionKey} launch={launch} />
}
