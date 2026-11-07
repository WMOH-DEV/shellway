import { useEffect, useMemo, useState } from 'react'
import type { AttentionItem, AttentionLevel, ServerFacts, ServerSection } from '@/types/server/core'
import { AREAS } from '@/utils/server/areas'
import { useSslCritical } from '@/hooks/useSslCritical'
import { serverApi } from './serverApi'

export const SSL_CRITICAL_ID = 'sites.https.critical'

const LEVEL_ORDER: readonly AttentionLevel[] = ['error', 'warning', 'info']

const SSL_CRITICAL_ITEM: AttentionItem = {
  id: SSL_CRITICAL_ID,
  area: 'sites',
  level: 'error',
  rank: 150,
  title: 'HTTPS is broken or about to break',
  detail: 'At least one site has a certificate that has failed or will fail soon.',
  actionLabel: 'Check HTTPS',
  route: { section: 'sites', sub: 'https' }
}

export function areaAttention(facts: ServerFacts): AttentionItem[] {
  return AREAS.flatMap((area) => area.attention(facts))
}

export function withSslCritical(items: readonly AttentionItem[], sslCritical: boolean): AttentionItem[] {
  if (!sslCritical || items.some((item) => item.id === SSL_CRITICAL_ID)) return [...items]
  return [...items, SSL_CRITICAL_ITEM]
}

export function rankAttention(items: readonly AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => b.rank - a.rank)
}

export function worstLevel(items: readonly AttentionItem[]): AttentionLevel | null {
  return LEVEL_ORDER.find((level) => items.some((item) => item.level === level)) ?? null
}

export function countsByArea(items: readonly AttentionItem[]): Partial<Record<ServerSection, number>> {
  const counts: Partial<Record<ServerSection, number>> = {}
  for (const item of items) counts[item.area] = (counts[item.area] ?? 0) + 1
  return counts
}

function usePushedFacts(connectionId: string): ServerFacts {
  const [facts, setFacts] = useState<ServerFacts>({})

  useEffect(() => {
    let alive = true
    setFacts({})
    const api = serverApi()
    void api.facts(connectionId).then((result) => {
      if (alive && result.success) setFacts((pushed) => ({ ...result.data, ...pushed }))
    })
    const off = api.onFacts((id, next) => {
      if (id === connectionId) setFacts((previous) => ({ ...previous, ...next }))
    })
    return () => { alive = false; off() }
  }, [connectionId])

  return facts
}

export function useServerAttention(connectionId: string, connected: boolean): AttentionItem[] {
  const facts = usePushedFacts(connectionId)
  const sslCritical = useSslCritical(connectionId, connected)
  return useMemo(() => rankAttention(withSslCritical(areaAttention(facts), sslCritical)), [facts, sslCritical])
}
