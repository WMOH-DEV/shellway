import { useCallback } from 'react'
import { serverApi } from './serverApi'

export type WithOsFamily = (params: Record<string, unknown>) => Promise<Record<string, unknown>>

export function useWithOsFamily(sessionId: string): WithOsFamily {
  return useCallback(async (params) => {
    const saved = await serverApi().settings.prefs(sessionId).catch(() => null)
    const osFamily = saved?.success ? saved.data.osFamily : 'auto'
    return osFamily === 'auto' ? params : { ...params, osFamily }
  }, [sessionId])
}
