import { useCallback, useMemo, useState } from 'react'
import type { InstallPlan, InstallRoute, PrepFacts } from '@/types/ssl'
import { installPlan, isCertbotReady } from '@/utils/ssl/https/installPlan'
import { installOutcome, type InstallOutcome } from '@/utils/ssl/addHttps/prepView'
import { sslApi } from '../sslApi'
import { useSslResource, type SslResource } from '../settings/useSslResource'
import { useStreamedRun, type StreamedRun } from './useStreamedRun'

export interface Prepare {
  prep: SslResource<PrepFacts>
  facts: PrepFacts | null
  plan: InstallPlan | null
  ready: boolean
  manual: boolean
  setManual: (manual: boolean) => void
  setRoute: (route: InstallRoute) => void
  run: StreamedRun
  outcome: InstallOutcome | null
  install: () => Promise<void>
}

export function usePrepare(connectionId: string): Prepare {
  const load = useCallback(() => sslApi().httpsPrep(connectionId), [connectionId])
  const prep = useSslResource(load)
  const [route, setRoute] = useState<InstallRoute>('snap')
  const [manual, setManual] = useState(false)
  const [outcome, setOutcome] = useState<InstallOutcome | null>(null)
  const run = useStreamedRun()
  const facts = prep.data
  const plan = useMemo(() => (facts ? installPlan(facts, route) : null), [facts, route])

  const install = async () => {
    if (!plan || plan.blockedReason || prep.loading) return
    setOutcome(null)
    const { data, error } = await run.start((runId) => sslApi().httpsInstall(connectionId, plan.route, runId))
    setOutcome(installOutcome(data, error))
    await prep.reload()
  }

  return { prep, facts, plan, ready: facts !== null && isCertbotReady(facts), manual, setManual, setRoute, run, outcome, install }
}
