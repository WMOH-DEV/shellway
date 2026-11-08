import type { ProbeResult } from '@/types/server/core'
import { IDENTITY_PROBE, type ServerIdentity } from '@/types/server/identity'
import type { ConnectionStatus } from '@/types/session'
import { StatusDot, type KitTone } from '../kit'
import { useServerFacts } from '../useServerFacts'
import { addressLine, sizeLine } from './identityFormat'

const IDENTITY_PROBES = [IDENTITY_PROBE]

export function connectionTone(status: ConnectionStatus): KitTone {
  if (status === 'connected') return 'success'
  if (status === 'error') return 'error'
  if (status === 'disconnected') return 'neutral'
  return 'warning'
}

function Placeholder({ width }: { width: string }) {
  return <span className={`block h-3 animate-pulse rounded bg-nd-surface-raised ${width}`} aria-hidden />
}

function IdentityLines({ result }: { result: ProbeResult | undefined }) {
  if (result?.status === 'ok') {
    const identity = result.data as ServerIdentity
    return (
      <>
        <span className="truncate text-xs text-nd-text-muted">{sizeLine(identity)}</span>
        <span className="truncate font-mono text-[11.5px] text-nd-text-muted">{addressLine(identity)}</span>
      </>
    )
  }
  if (result) return <span className="text-xs text-nd-text-muted">Server details unavailable</span>
  return (
    <>
      <Placeholder width="w-36" />
      <Placeholder width="w-28" />
    </>
  )
}

export function IdentityBlock({ connectionId, active, name, status }: { connectionId: string; active: boolean; name: string; status: ConnectionStatus }) {
  const { facts } = useServerFacts({ connectionId, active }, IDENTITY_PROBES)
  return (
    <div className="flex min-w-0 flex-col gap-[3px] px-2.5 pb-3.5 pt-1">
      <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-nd-text-primary">
        <StatusDot tone={connectionTone(status)} label={status} />
        <span className="truncate">{name}</span>
      </span>
      <IdentityLines result={facts[IDENTITY_PROBE]} />
    </div>
  )
}
