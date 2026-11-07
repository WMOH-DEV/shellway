import { useCallback } from 'react'
import type { ProbeResult } from '@/types/server/core'
import { PACKAGES_PROBE, PHP_PROBE, UPDATES_PROBE, USAGE_PROBE, type PackagesFacts, type PhpFacts, type UpdatesFacts, type UsageFacts } from '@/utils/server/software/types'
import { useActionLauncher } from '../../action'
import { useServerFacts } from '../../useServerFacts'
import type { ServerSectionContext } from '../types'
import { useWithOsFamily } from '../../useWithOsFamily'

const PROBES = [UPDATES_PROBE, PACKAGES_PROBE, PHP_PROBE, USAGE_PROBE]

const dataOf = <T,>(result: ProbeResult | undefined): T | null => (result?.status === 'ok' ? (result.data as T) : null)

export interface SoftwareState {
  updates: ProbeResult<UpdatesFacts> | undefined
  packages: ProbeResult<PackagesFacts> | undefined
  php: ProbeResult<PhpFacts> | undefined
  phpData: PhpFacts | null
  packagesData: PackagesFacts | null
  usageData: UsageFacts | null
  loading: boolean
  refresh(): Promise<void>
  run(type: string, params: unknown): void
}

const INSTALL = 'software.install'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export function useSoftware(ctx: ServerSectionContext): SoftwareState {
  const { facts, loading, refresh } = useServerFacts(ctx, PROBES)
  const launcher = useActionLauncher(ctx)
  const withOsFamily = useWithOsFamily(ctx.sessionId)
  const run = useCallback((type: string, params: unknown) => {
    const finalParams = type === INSTALL && isRecord(params) ? withOsFamily(params) : params
    launcher.launch({ type, params: finalParams, onFinished: () => void refresh() })
  }, [launcher, refresh, withOsFamily])
  return {
    updates: facts[UPDATES_PROBE] as ProbeResult<UpdatesFacts> | undefined,
    packages: facts[PACKAGES_PROBE] as ProbeResult<PackagesFacts> | undefined,
    php: facts[PHP_PROBE] as ProbeResult<PhpFacts> | undefined,
    phpData: dataOf<PhpFacts>(facts[PHP_PROBE]),
    packagesData: dataOf<PackagesFacts>(facts[PACKAGES_PROBE]),
    usageData: dataOf<UsageFacts>(facts[USAGE_PROBE]),
    loading,
    refresh,
    run
  }
}
