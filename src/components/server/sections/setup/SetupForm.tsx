import { useMemo, useState } from 'react'
import type { ActionRun } from '@/types/server/core'
import { Button } from '@/components/ui/Button'
import type { DebianRelease } from '@/utils/server/install/releases'
import { PROFILES, SECURITY_DEFAULTS, profileRows, rowChoices, swapSizeGb } from '@/utils/server/setup/catalog'
import { planComponents } from '@/utils/server/setup/components'
import { setupSummary } from '@/utils/server/setup/plan'
import type { ProfileId, RowChoice, RowId, SecurityChoices, SecurityId, SetupInventory, SetupParams } from '@/utils/server/setup/types'
import { SETUP_RUN } from '@/utils/server/areas/setup'
import { useActionLauncher } from '../../action'
import { Notice } from '../../kit'
import type { ServerSectionContext } from '../types'
import { ProfilePicker } from './ProfilePicker'
import { RunResult } from './RunResult'
import { SecurityCard } from './SecurityCard'
import { SoftwareCard } from './SoftwareCard'
import { SummaryAside } from './SummaryAside'
import { useKeyLogin } from './useKeyLogin'

interface SetupFormProps {
  ctx: ServerSectionContext
  release: DebianRelease
  inventory: SetupInventory
  onFinished(run: ActionRun): void
  lastRun: ActionRun | null
}

const profileTitle = (profile: ProfileId): string => PROFILES.find((item) => item.id === profile)?.title ?? 'Custom'

export function SetupForm({ ctx, release, inventory, onFinished, lastRun }: SetupFormProps) {
  const keyLogin = useKeyLogin(ctx.sessionId)
  const launcher = useActionLauncher(ctx)
  const [profile, setProfile] = useState<ProfileId>('laravel')
  const [rows, setRows] = useState(() => profileRows('laravel', release))
  const [security, setSecurity] = useState<SecurityChoices>(SECURITY_DEFAULTS)

  const params: SetupParams = useMemo(() => ({ profile, rows, security: { ...security, passwordLoginOff: security.passwordLoginOff && keyLogin }, keyLogin }), [profile, rows, security, keyLogin])
  const components = useMemo(() => planComponents(rows, inventory), [rows, inventory])
  const summary = useMemo(() => setupSummary(params, inventory), [params, inventory])
  const choices = useMemo(() => rowChoices(release, inventory.commands.includes('snap')), [release, inventory])

  const pickProfile = (next: ProfileId) => {
    setProfile(next)
    setRows(profileRows(next, release))
  }
  const changeRow = (id: RowId, choice: RowChoice) => setRows((current) => ({ ...current, [id]: choice }))
  const changeSecurity = (id: SecurityId, on: boolean) => setSecurity((current) => ({ ...current, [id]: on }))
  const review = () => launcher.launch({ type: SETUP_RUN, params, onFinished })

  return (
    <>
      {lastRun && <RunResult run={lastRun} deployUser={params.security.deployUser} />}
      <ProfilePicker value={profile} onChange={pickProfile} />
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-3.5">
          <SoftwareCard profileTitle={profileTitle(profile)} rows={rows} choices={choices} installed={components.installedRows} onChange={changeRow} />
          <SecurityCard security={params.security} swapGb={swapSizeGb(inventory.memoryBytes)} keyLogin={keyLogin} onChange={changeSecurity} />
        </div>
        <SummaryAside summary={summary} onCreateSite={() => ctx.navigate({ section: 'sites' })} />
      </div>
      {components.problems.length > 0 && <Notice tone="warning" title="Fix this before reviewing the plan">{components.problems.join(' ')}</Notice>}
      <footer className="flex items-center gap-2.5 pt-1">
        <Button variant="secondary" onClick={() => ctx.navigate({ section: 'overview' })}>Skip, I'll set it up myself</Button>
        <div className="flex-1" />
        <span className="text-[13px] text-nd-text-muted">Next: review every command</span>
        <Button variant="primary" disabled={components.problems.length > 0} onClick={review}>Review plan</Button>
      </footer>
    </>
  )
}
