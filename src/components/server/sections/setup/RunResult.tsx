import type { ActionRun } from '@/types/server/core'
import { DEPLOY_USER } from '@/utils/server/setup/security'
import { Notice } from '../../kit'

const DEPLOY_NEXT = `The ${DEPLOY_USER} user is ready. Shellway keeps logging in as before; to use ${DEPLOY_USER}, check that your key works for it, then change the user in this server's saved settings.`

export function RunResult({ run, deployUser }: { run: ActionRun; deployUser: boolean }) {
  if (run.status === 'done') {
    return <Notice tone="success" title="This server is set up">{deployUser ? DEPLOY_NEXT : 'Everything in the plan finished.'}</Notice>
  }
  if (run.status === 'running') return null
  return (
    <Notice tone="error" title="Setup did not finish">
      {run.failure?.message ?? 'A step failed.'} The steps before it stay done. Fix the cause, then review the plan again; installed parts are skipped.
    </Notice>
  )
}
