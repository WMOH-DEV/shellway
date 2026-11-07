import { useState } from 'react'
import { toast } from '@/components/ui/Toast'
import type { DeployOptions, DeployResult } from '@/types/deploy'
import { deployApi } from './useDeploySites'

export interface DeployActions {
  starting: ReadonlySet<string>
  deployNow: (name: string, options?: DeployOptions) => void
  approve: (name: string) => void
  cancel: (name: string) => void
  resume: (name: string) => void
}

function useStartingSites(): [ReadonlySet<string>, (name: string, task: () => Promise<void>) => Promise<void>] {
  const [starting, setStarting] = useState<ReadonlySet<string>>(new Set())
  const track = async (name: string, task: () => Promise<void>) => {
    setStarting((prev) => new Set(prev).add(name))
    try {
      await task()
    } finally {
      setStarting((prev) => {
        const next = new Set(prev)
        next.delete(name)
        return next
      })
    }
  }
  return [starting, track]
}

export function useDeployActions(connectionId: string, refresh: () => Promise<void>): DeployActions {
  const [starting, track] = useStartingSites()

  const siteAction = (name: string, call: () => Promise<DeployResult<unknown>>, failure: string, onStarted: () => void) =>
    void track(name, async () => {
      const result = await call()
      if (!result.success) {
        toast.error(failure, result.error)
        return
      }
      onStarted()
      await refresh()
    })

  return {
    starting,
    deployNow: (name, options) => siteAction(name, () => deployApi().deploy(connectionId, name, options), `Could not deploy ${name}`, () => toast.info(`Deploying ${name}…`)),
    approve: (name) => siteAction(name, () => deployApi().approve(connectionId, name), `Could not approve ${name}`, () => toast.info(`Deploying ${name}…`)),
    cancel: (name) => siteAction(name, () => deployApi().cancel(connectionId, name), `Could not cancel ${name}`, () => toast.info(`Cancelling ${name}…`)),
    resume: (name) => siteAction(
      name,
      () => deployApi().resume(connectionId, name),
      `Could not resume the auto check for ${name}`,
      () => toast.success(`Auto check resumed for ${name}`, 'It looks for new commits again within a minute')
    )
  }
}
