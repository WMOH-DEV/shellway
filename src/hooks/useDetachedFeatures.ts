import { useEffect } from 'react'
import { reattachFeature } from '@/utils/windowHandoff'

export function useDetachedFeatures(): void {
  useEffect(() => {
    const unsubscribe = window.novadeck.window.onFeatureClosed(reattachFeature)
    return () => { unsubscribe() }
  }, [])
}
