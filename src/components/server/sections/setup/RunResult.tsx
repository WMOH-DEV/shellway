import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useSessionStore } from '@/stores/sessionStore'
import type { ActionRun } from '@/types/server/core'
import { Notice } from '../../kit'
import { serverApi } from '../../serverApi'

const DEPLOY_USER_STEP = 'security.deploy-user'

interface RunResultProps {
  run: ActionRun
  deployUser: string | null
  keyLogin: boolean
  connectionId: string
  sessionId: string
}

type SwitchState = { kind: 'idle' | 'checking' | 'saved' } | { kind: 'failed'; message: string }

const createdUser = (run: ActionRun): boolean => run.steps.some((step) => step.id === DEPLOY_USER_STEP && step.status === 'done')

const deployNext = (user: string, canSwitch: boolean): string =>
  canSwitch
    ? `The ${user} user is ready. Shellway still logs in as before. Switch when you are ready: Shellway first checks that your key logs in as ${user}.`
    : `The ${user} user is ready. Shellway keeps logging in as before; to use ${user}, check that your key works for it, then change the user in this server's saved settings.`

async function switchLogin(connectionId: string, sessionId: string, user: string): Promise<void> {
  const checked = await serverApi().setup.checkLogin(connectionId, user)
  if (!checked.success) throw new Error(checked.error)
  await window.novadeck.sessions.update(sessionId, { username: user })
  useSessionStore.getState().updateSession(sessionId, { username: user })
}

function SwitchLogin({ user, connectionId, sessionId }: { user: string; connectionId: string; sessionId: string }) {
  const [state, setState] = useState<SwitchState>({ kind: 'idle' })
  const start = () => {
    setState({ kind: 'checking' })
    switchLogin(connectionId, sessionId, user).then(
      () => setState({ kind: 'saved' }),
      (err: unknown) => setState({ kind: 'failed', message: err instanceof Error ? err.message : 'The login check failed.' })
    )
  }
  if (state.kind === 'saved') return <span className="text-xs text-nd-success-fg">Saved. Next time you connect, Shellway logs in as {user}.</span>
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Button variant="secondary" disabled={state.kind === 'checking'} onClick={start}>Log in as {user} from now on</Button>
      {state.kind === 'checking' && <span className="text-xs text-nd-text-muted">Checking a new login as {user}…</span>}
      {state.kind === 'failed' && <span className="text-xs text-nd-error-fg">Nothing was changed. {state.message}</span>}
    </div>
  )
}

export function RunResult({ run, deployUser, keyLogin, connectionId, sessionId }: RunResultProps) {
  if (run.status === 'done') {
    const switchable = deployUser !== null && keyLogin && createdUser(run)
    return (
      <Notice tone="success" title="This server is set up">
        <div className="flex flex-col gap-2">
          <span>{deployUser ? deployNext(deployUser, switchable) : 'Everything in the plan finished.'}</span>
          {switchable && <SwitchLogin user={deployUser} connectionId={connectionId} sessionId={sessionId} />}
        </div>
      </Notice>
    )
  }
  if (run.status === 'running') return null
  return (
    <Notice tone="error" title="Setup did not finish">
      {run.failure?.message ?? 'A step failed.'} The steps before it stay done. Fix the cause, then review the plan again; installed parts are skipped.
    </Notice>
  )
}
