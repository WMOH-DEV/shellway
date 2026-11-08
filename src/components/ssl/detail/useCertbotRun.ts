import { useCallback, useEffect, useRef, useState } from 'react'
import type { CertbotAction } from '@/types/ssl'
import { actionOutcome, type ActionOutcome } from '@/utils/ssl/certbotActions'
import { sslApi } from '../sslApi'

export interface CertbotRun {
  lineage: string | null
  running: CertbotAction | null
  output: string
  outcome: ActionOutcome | null
  start: (lineage: string, action: CertbotAction) => Promise<void>
}

export function useCertbotRun(connectionId: string, onFinished: () => void): CertbotRun {
  const [lineage, setLineage] = useState<string | null>(null)
  const [running, setRunning] = useState<CertbotAction | null>(null)
  const [output, setOutput] = useState('')
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null)
  const mounted = useRef(true)
  const busy = useRef(false)
  const finished = useRef(onFinished)
  finished.current = onFinished

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const start = useCallback(async (target: string, action: CertbotAction) => {
    if (busy.current) return
    busy.current = true
    const runId = crypto.randomUUID()
    setLineage(target)
    setRunning(action)
    setOutput('')
    setOutcome(null)
    const stopListening = sslApi().onOutput((id, chunk) => {
      if (id === runId && mounted.current) setOutput((current) => current + chunk)
    })
    try {
      const result = await sslApi().runCertbot(connectionId, target, action, runId)
      if (mounted.current) {
        if (result.success && result.data) {
          const full = result.data.output
          setOutput((current) => current || full)
          setOutcome(actionOutcome(action, result.data))
        } else {
          setOutcome(actionOutcome(action, null, result.error))
        }
      }
    } catch (err) {
      if (mounted.current) setOutcome(actionOutcome(action, null, (err as Error).message))
    } finally {
      stopListening()
      busy.current = false
      if (mounted.current) setRunning(null)
    }
    finished.current()
  }, [connectionId])

  return { lineage, running, output, outcome, start }
}
