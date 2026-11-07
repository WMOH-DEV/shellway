import { useCallback, useEffect, useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { ProbeResult } from '@/types/server/core'
import { securityAttention } from '@/utils/server/security/attention'
import { FAIL2BAN_PROBE, type Fail2banFacts } from '@/utils/server/security/fail2ban'
import { HARDENING_PROBE, type HardeningFacts } from '@/utils/server/security/hardening'
import { KEYS_PROBE, type KeysFacts } from '@/utils/server/security/keys'
import { SSH_PROBE, type SshFacts } from '@/utils/server/security/ssh'
import { UFW_PROBE, type UfwFacts } from '@/utils/server/security/ufw'
import { useActionLauncher } from '../../action'
import { Chip, Notice, PageHeader, SectionPage } from '../../kit'
import { useServerFacts } from '../../useServerFacts'
import type { ServerSectionContext } from '../types'
import { Fail2banCard } from './Fail2banCard'
import { FirewallCard } from './FirewallCard'
import { GuardDialog } from './GuardDialog'
import { HardeningCard } from './HardeningCard'
import { SshCard } from './SshCard'
import type { SecurityActions } from './types'
import { useGuard, useSecuritySession } from './useGuard'

const PROBES = [UFW_PROBE, SSH_PROBE, KEYS_PROBE, FAIL2BAN_PROBE, HARDENING_PROBE]

const typed = <T,>(result: ProbeResult | undefined) => result as ProbeResult<T> | undefined

function useFocus(focus: string | undefined, active: boolean): void {
  useEffect(() => {
    if (active && focus) document.getElementById(`security-${focus}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [focus, active])
}

export function SecurityPage({ ctx }: { ctx: ServerSectionContext }) {
  const { facts, loading, refresh } = useServerFacts(ctx, PROBES)
  const launcher = useActionLauncher(ctx)
  const session = useSecuritySession(ctx)
  const settle = useCallback(() => void refresh(), [refresh])
  const guard = useGuard(ctx, settle)
  const recommendations = securityAttention(facts).length
  useFocus(ctx.route.params?.focus, ctx.active)

  const actions = useMemo<SecurityActions>(() => ({
    canGuard: session?.canVerify ?? false,
    session,
    guard: guard.start,
    launch: (type, params) => launcher.launch({ type, params, onFinished: settle })
  }), [session, guard.start, launcher, settle])

  return (
    <SectionPage>
      <PageHeader
        title="Security"
        subtitle="Firewall, SSH access, brute-force protection and updates."
        actions={
          <>
            {recommendations > 0 && <Chip tone="warning">{recommendations === 1 ? '1 recommendation' : `${recommendations} recommendations`}</Chip>}
            <Button size="sm" variant="ghost" aria-label="Refresh" disabled={loading} onClick={settle}><RefreshCw size={14} /></Button>
          </>
        }
      />
      {session && !session.canVerify ? (
        <Notice tone="warning" title="Firewall and SSH changes are off for this session">{session.reason}</Notice>
      ) : (
        <Notice tone="info" title="Lockout guard is on.">
          Before a firewall or SSH change, Shellway starts a 60-second undo timer on the server, applies the change, then logs in again with a new connection. If that fails, the change is undone automatically. Your SSH port is never closed.
        </Notice>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <FirewallCard result={typed<UfwFacts>(facts[UFW_PROBE])} actions={actions} />
          <SshCard ssh={typed<SshFacts>(facts[SSH_PROBE])} keys={typed<KeysFacts>(facts[KEYS_PROBE])} actions={actions} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Fail2banCard result={typed<Fail2banFacts>(facts[FAIL2BAN_PROBE])} actions={actions} />
          <HardeningCard ctx={ctx} result={typed<HardeningFacts>(facts[HARDENING_PROBE])} actions={actions} />
        </div>
      </div>
      <GuardDialog guard={guard} />
    </SectionPage>
  )
}
