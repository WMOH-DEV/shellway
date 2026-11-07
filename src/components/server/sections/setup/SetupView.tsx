import { useState } from 'react'
import type { ActionRun, ProbeResult, ServerFacts } from '@/types/server/core'
import { IDENTITY_PROBE, type ServerIdentity } from '@/types/server/identity'
import { findRelease, releaseSupport } from '@/utils/server/install/releases'
import { isFreshServer } from '@/utils/server/setup/fresh'
import { INVENTORY_PROBE } from '@/utils/server/setup/inventory'
import type { SetupInventory } from '@/utils/server/setup/types'
import { Notice, PageHeader, ProbeState, SectionPage } from '../../kit'
import { useServerFacts } from '../../useServerFacts'
import type { ServerSectionContext } from '../types'
import { SetupForm } from './SetupForm'
import { SetupSteps } from './SetupSteps'

const PROBES = [IDENTITY_PROBE, INVENTORY_PROBE]

const PICK = 'Pick what it should run; you review every command before anything happens.'

function subtitle(facts: ServerFacts): string {
  const identity = facts[IDENTITY_PROBE]
  if (identity?.status !== 'ok') return PICK
  const name = (identity.data as ServerIdentity).os.prettyName
  return isFreshServer(facts) ? `Fresh ${name} detected: nothing installed yet. ${PICK}` : `${name} detected. ${PICK}`
}

const stepFor = (run: ActionRun | null): number => {
  if (!run) return 0
  return run.status === 'done' ? 3 : 2
}

export function SetupView({ ctx }: { ctx: ServerSectionContext }) {
  const { facts, refresh } = useServerFacts(ctx, PROBES)
  const [lastRun, setLastRun] = useState<ActionRun | null>(null)

  const finished = (run: ActionRun) => {
    setLastRun(run)
    void refresh()
  }

  return (
    <SectionPage>
      <PageHeader title="Set up this server" subtitle={subtitle(facts)} actions={<SetupSteps current={stepFor(lastRun)} />} />
      <ProbeState result={facts[IDENTITY_PROBE] as ProbeResult<ServerIdentity> | undefined} label="the operating system">
        {(identity) => {
          const release = findRelease(identity.os)
          if (!release) return <Notice tone="warning" title="Shellway cannot set up this system yet">{releaseSupport(identity.os)}</Notice>
          return (
            <ProbeState result={facts[INVENTORY_PROBE] as ProbeResult<SetupInventory> | undefined} label="installed software">
              {(inventory) => <SetupForm ctx={ctx} release={release} inventory={inventory} lastRun={lastRun} onFinished={finished} />}
            </ProbeState>
          )
        }}
      </ProbeState>
    </SectionPage>
  )
}
