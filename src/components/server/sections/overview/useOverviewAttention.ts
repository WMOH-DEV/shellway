import { useMemo } from 'react'
import type { AreaModule, AttentionItem, ServerFacts } from '@/types/server/core'
import { ALL_PROBES, AREAS } from '@/utils/server/areas'
import { rankAttention } from '@/utils/server/overview/attention'
import { ON_DEMAND_PROBES } from '@/utils/server/overview/ids'
import { useServerFacts } from '../../useServerFacts'
import type { ServerSectionContext } from '../types'

export interface OverviewAttention {
  items: AttentionItem[]
  loading: boolean
}

const ATTENTION_PROBES = ALL_PROBES.map((probe) => probe.id).filter((id) => !ON_DEMAND_PROBES.includes(id))

function areaAttention(area: AreaModule, facts: ServerFacts): AttentionItem[] {
  try {
    return area.attention(facts)
  } catch {
    return []
  }
}

export function useOverviewAttention(ctx: ServerSectionContext): OverviewAttention {
  const { facts, loading } = useServerFacts(ctx, ATTENTION_PROBES)
  const items = useMemo(() => rankAttention(AREAS.flatMap((area) => areaAttention(area, facts))), [facts])
  return { items, loading }
}
