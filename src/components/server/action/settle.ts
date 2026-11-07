import type { ServerResult } from '@/types/server/core'

export function settle<T>(request: Promise<ServerResult<T>>): Promise<ServerResult<T>> {
  return request.catch((error: unknown) => ({ success: false, error: error instanceof Error ? error.message : String(error) }))
}
