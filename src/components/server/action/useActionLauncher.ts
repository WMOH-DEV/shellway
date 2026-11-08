import { useMemo } from 'react'
import { launchAction } from '@/stores/serverActionStore'
import type { ServerSectionContext } from '../sections/types'
import type { ActionLauncher } from './types'

export function useActionLauncher(ctx: Pick<ServerSectionContext, 'tabId' | 'connectionId'>): ActionLauncher {
  const { tabId, connectionId } = ctx
  return useMemo(() => ({ launch: (request) => launchAction(tabId, connectionId, request) }), [tabId, connectionId])
}
