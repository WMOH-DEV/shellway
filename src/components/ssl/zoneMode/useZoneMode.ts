import { useCallback, useRef, useState } from 'react'
import type { SslMode, ZoneModeResult, ZonePreflight } from '@/types/ssl'
import { canApplyStrict, confirmedNames, revertableMode } from '@/utils/ssl/zoneMode/zoneModeView'
import { useMounted } from '../originCa/useMounted'
import { useSslResource } from '../settings/useSslResource'
import { sslApi } from '../sslApi'

export type ZoneChange = { kind: 'applied'; result: ZoneModeResult } | { kind: 'reverted'; result: ZoneModeResult }

export interface ZoneModeFlow {
  preflight: ZonePreflight | null
  checking: boolean
  checkError: string | null
  recheck: () => void
  confirmed: boolean
  setConfirmed: (confirmed: boolean) => void
  canApply: boolean
  busy: boolean
  changeError: string | null
  change: ZoneChange | null
  revertMode: SslMode | null
  apply: () => void
  revert: () => void
}

export function useZoneMode(zone: string): ZoneModeFlow {
  const load = useCallback(() => sslApi().zonePreflight(zone), [zone])
  const resource = useSslResource(load)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [changeError, setChangeError] = useState<string | null>(null)
  const [change, setChange] = useState<ZoneChange | null>(null)
  const inFlight = useRef(false)
  const mounted = useMounted()

  const preflight = resource.error ? null : resource.data
  const checking = resource.loading

  const submit = async (mode: SslMode, confirmedUnknown: string[]): Promise<ZoneModeResult | null> => {
    if (inFlight.current) return null
    inFlight.current = true
    setBusy(true)
    setChangeError(null)
    try {
      const result = await sslApi().zoneSetMode(zone, mode, confirmedUnknown)
      if (result.success && result.data) return result.data
      if (mounted.current) setChangeError(result.error ?? 'Cloudflare did not accept the change')
      return null
    } catch (error) {
      if (mounted.current) setChangeError(error instanceof Error ? error.message : 'Cloudflare did not accept the change')
      return null
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const canApply = preflight !== null && !checking && !busy && change === null && canApplyStrict(preflight, confirmed)

  const apply = () => {
    if (!preflight || !canApply) return
    void submit('strict', confirmedNames(preflight, confirmed)).then((result) => {
      if (result && mounted.current) setChange({ kind: 'applied', result })
    })
  }

  const revertMode = change?.kind === 'applied' ? revertableMode(change.result.previousMode) : null

  const revert = () => {
    if (!revertMode) return
    void submit(revertMode, []).then((result) => {
      if (result && mounted.current) setChange({ kind: 'reverted', result })
    })
  }

  const recheck = () => {
    if (busy || checking) return
    setConfirmed(false)
    void resource.reload()
  }

  return { preflight, checking, checkError: resource.error, recheck, confirmed, setConfirmed, canApply, busy, changeError, change, revertMode, apply, revert }
}
