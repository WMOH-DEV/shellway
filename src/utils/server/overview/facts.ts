import type { ProbeResult } from '@/types/server/core'

export const okData = <T>(result: ProbeResult | undefined): T | null => (result?.status === 'ok' ? (result.data as T) : null)
