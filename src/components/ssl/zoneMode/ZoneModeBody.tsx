import { Spinner } from '@/components/ui/Spinner'
import type { ZonePreflight } from '@/types/ssl'
import { blockedMessage, modeLabel, unknownNames } from '@/utils/ssl/zoneMode/zoneModeView'
import { Callout } from './Callout'
import { ProbeTable } from './ProbeTable'
import type { ZoneModeFlow } from './useZoneMode'

function Checking({ zone }: { zone: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2.5 text-[13px] text-nd-text-secondary">
      <Spinner size="sm" />
      Checking every proxied hostname in {zone} from this computer…
    </div>
  )
}

function UnknownConfirm({ preflight, flow }: { preflight: ZonePreflight; flow: ZoneModeFlow }) {
  const names = unknownNames(preflight)
  if (names.length === 0) return null
  return (
    <Callout tone="warning">
      <span>Shellway could not check {names.length === 1 ? 'one hostname' : `${names.length} hostnames`} from this computer. Full (strict) breaks a hostname whose origin has no valid certificate.</span>
      <label className="flex items-center gap-2 text-[13px] text-nd-text-primary">
        <input
          type="checkbox"
          className="h-4 w-4 accent-nd-accent"
          checked={flow.confirmed}
          disabled={flow.busy}
          onChange={(event) => flow.setConfirmed(event.target.checked)}
        />
        I've checked these hostnames myself
      </label>
    </Callout>
  )
}

function Preflight({ preflight, flow }: { preflight: ZonePreflight; flow: ZoneModeFlow }) {
  const blocked = blockedMessage(preflight)
  return (
    <>
      {blocked && (
        <Callout tone="error" role="alert">
          <span><strong className="font-semibold">Cannot switch yet.</strong> {blocked}</span>
        </Callout>
      )}
      <ProbeTable zone={preflight.zone} hosts={preflight.hosts} />
      <UnknownConfirm preflight={preflight} flow={flow} />
    </>
  )
}

function Outcome({ flow, zone }: { flow: ZoneModeFlow; zone: string }) {
  if (!flow.change) return null
  const { kind, result } = flow.change
  const text = kind === 'applied' ? `${zone} now uses ${modeLabel(result.mode)}.` : `${zone} is back to ${modeLabel(result.mode)}.`
  return <Callout tone="success" role="status"><span>{text}</span></Callout>
}

export function ZoneModeBody({ zone, flow }: { zone: string; flow: ZoneModeFlow }) {
  const showPreflight = flow.change === null
  return (
    <div className="flex max-w-[860px] flex-col gap-4">
      <p className="text-[13px] text-nd-text-muted">
        The SSL mode applies to every proxied hostname in {zone}, not only one. Shellway checks each origin first.
      </p>
      <Outcome flow={flow} zone={zone} />
      {flow.changeError && <Callout tone="error" role="alert"><span>{flow.changeError}</span></Callout>}
      {showPreflight && flow.checking && <Checking zone={zone} />}
      {showPreflight && !flow.checking && flow.checkError && <Callout tone="error" role="alert"><span>{flow.checkError}</span></Callout>}
      {showPreflight && !flow.checking && flow.preflight && <Preflight preflight={flow.preflight} flow={flow} />}
    </div>
  )
}
