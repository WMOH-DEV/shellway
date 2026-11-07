import { useCallback } from 'react'
import { useServerPrefs } from './sections/setup/useServerPrefs'

export type WithOsFamily = (params: Record<string, unknown>) => Record<string, unknown>

export function useWithOsFamily(sessionId: string): WithOsFamily {
  const osFamily = useServerPrefs(sessionId).prefs?.osFamily ?? 'auto'
  return useCallback((params) => (osFamily === 'auto' ? params : { ...params, osFamily }), [osFamily])
}
