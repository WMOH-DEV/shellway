import type { AttentionItem } from '@/types/server/core'
import { ALL_PROBES } from '@/utils/server/areas'
import { ON_DEMAND_PROBES } from '@/utils/server/overview/ids'
import { useAttentionItems } from '../../attentionContext'
import { useServerFacts } from '../../useServerFacts'
import type { ServerSectionContext } from '../types'

export interface OverviewAttention {
  items: readonly AttentionItem[]
  loading: boolean
}

const ATTENTION_PROBES = ALL_PROBES.map((probe) => probe.id).filter((id) => !ON_DEMAND_PROBES.includes(id))

export function useOverviewAttention(ctx: ServerSectionContext): OverviewAttention {
  const { loading } = useServerFacts(ctx, ATTENTION_PROBES)
  return { items: useAttentionItems(), loading }
}
