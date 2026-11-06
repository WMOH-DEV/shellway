import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OriginKeyType, OriginValidityYears, SslReport, SwitchCheck, SwitchPrepared, SwitchResult } from '@/types/ssl'
import { switchCheck } from '@/utils/ssl/originCa/switchCheck'
import { prepareStage, stepDetails, type SwitchStep } from '@/utils/ssl/switchWizard/steps'
import { sslApi } from '../sslApi'
import { useStreamedRun, type StreamedRun } from '../https/useStreamedRun'
import { useMounted } from './useMounted'
import { useUndoSwitch, type UndoSwitch } from './useUndoSwitch'

export type SwitchPhase = 'explain' | 'prepare' | 'review' | 'apply'

interface FlowOptions {
  connectionId: string
  sessionId: string
  report: SslReport
  hostName: string
  blockId: string
}

export interface SwitchFlow {
  phase: SwitchPhase
  step: SwitchStep
  details: Record<SwitchStep, string>
  keyType: OriginKeyType
  setKeyType: (keyType: OriginKeyType) => void
  years: OriginValidityYears
  setYears: (years: OriginValidityYears) => void
  check: SwitchCheck
  prepared: SwitchPrepared | null
  prepareRun: StreamedRun
  prepareError: string | null
  applyRun: StreamedRun
  applyResult: SwitchResult | null
  applyError: string | null
  undo: UndoSwitch
  busy: boolean
  applyAttempted: boolean
  prepare: () => Promise<void>
  apply: () => Promise<void>
  back: () => void
  abandon: () => void
}

export function useSwitchFlow({ connectionId, sessionId, report, hostName, blockId }: FlowOptions): SwitchFlow {
  const [phase, setPhase] = useState<SwitchPhase>('explain')
  const [keyType, setKeyTypeState] = useState<OriginKeyType>('ecc')
  const [years, setYearsState] = useState<OriginValidityYears>(15)
  const [prepared, setPrepared] = useState<SwitchPrepared | null>(null)
  const [prepareError, setPrepareError] = useState<string | null>(null)
  const [applyResult, setApplyResult] = useState<SwitchResult | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applyAttempted, setApplyAttempted] = useState(false)
  const prepareRun = useStreamedRun()
  const applyRun = useStreamedRun()
  const undo = useUndoSwitch(connectionId, sessionId, hostName)
  const mounted = useMounted()
  const pending = useRef<string | null>(null)
  const generation = useRef(0)
  const check = useMemo(() => switchCheck(report, blockId), [report, blockId])

  const cancelSwitch = useCallback((switchId: string) => {
    void sslApi().originCancel(connectionId, switchId).catch(() => undefined)
  }, [connectionId])

  const cancelPending = useCallback(() => {
    const switchId = pending.current
    pending.current = null
    if (switchId) cancelSwitch(switchId)
  }, [cancelSwitch])

  useEffect(() => cancelPending, [cancelPending])

  const discardPrepared = () => {
    generation.current += 1
    cancelPending()
    setPrepared(null)
  }

  const setKeyType = (next: OriginKeyType) => {
    if (next === keyType) return
    discardPrepared()
    setKeyTypeState(next)
  }

  const setYears = (next: OriginValidityYears) => {
    if (next === years) return
    discardPrepared()
    setYearsState(next)
  }

  const prepare = async () => {
    if (check.blockedReason !== null) return
    if (prepared) return setPhase('review')
    const ticket = ++generation.current
    setPrepareError(null)
    setPhase('prepare')
    const outcome = await prepareRun.start((runId) => sslApi().originPrepare(connectionId, sessionId, { blockId, keyType, validityYears: years }, runId))
    if (!mounted.current || ticket !== generation.current) {
      if (outcome.data) cancelSwitch(outcome.data.switchId)
      return
    }
    if (!outcome.data) return setPrepareError(outcome.error ?? 'The certificate could not be prepared')
    pending.current = outcome.data.switchId
    setPrepared(outcome.data)
    setPhase('review')
  }

  const apply = async () => {
    if (!prepared || check.blockedReason !== null) return
    const { switchId } = prepared
    pending.current = null
    setApplyAttempted(true)
    setApplyError(null)
    setApplyResult(null)
    setPhase('apply')
    const outcome = await applyRun.start((runId) => sslApi().originApply(connectionId, sessionId, switchId, runId))
    if (!mounted.current) return
    setApplyResult(outcome.data)
    setApplyError(outcome.error)
  }

  const back = () => {
    setPrepareError(null)
    setApplyError(null)
    setPhase(phase === 'apply' ? 'review' : 'explain')
  }

  return {
    phase,
    step: phase === 'prepare' ? prepareStage(prepareRun.output) : phase,
    details: stepDetails({ keyType, years, nameCount: check.names.length }),
    keyType,
    setKeyType,
    years,
    setYears,
    check,
    prepared,
    prepareRun,
    prepareError,
    applyRun,
    applyResult,
    applyError,
    undo,
    busy: prepareRun.running || applyRun.running || undo.run.running,
    applyAttempted,
    prepare,
    apply,
    back,
    abandon: cancelPending
  }
}
