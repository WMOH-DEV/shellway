import { useCallback, useEffect, useState } from 'react'
import type { SiteConfig } from '@/types/deploy'
import { sameConfig } from '@/utils/deploy/pipelineDraft'

export function usePipelineDraft(config: SiteConfig) {
  const [saved, setSaved] = useState(config)
  const [draft, setDraft] = useState(config)
  const configKey = JSON.stringify(config)

  useEffect(() => {
    setDraft((current) => (sameConfig(current, saved) ? config : current))
    setSaved(config)
  }, [configKey])

  const patch = useCallback((changes: Partial<SiteConfig>) => setDraft((current) => ({ ...current, ...changes })), [])
  const discard = useCallback(() => setDraft(saved), [saved])
  const markSaved = useCallback((next: SiteConfig) => setSaved(next), [])

  return { saved, draft, patch, discard, markSaved }
}
