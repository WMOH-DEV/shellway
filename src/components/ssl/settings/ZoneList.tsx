import { Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { CloudflareStatus, HostnameStatus } from '@/types/ssl'
import { modeLabel, offersStrict, STRICT_LABEL, zoneSslMode } from '@/utils/ssl/zoneMode/zoneModeView'
import { hostnameCount, hostnamesOutsideZones, outsideZonesWarning, zoneCoverage } from '@/utils/ssl/settingsZones'

interface ZoneListProps {
  zones: CloudflareStatus['zones']
  hostnames: HostnameStatus[]
  onSetStrict: (zone: string) => void
}

function ZoneModeControl({ zone, hostnames, onSetStrict }: { zone: string; hostnames: HostnameStatus[]; onSetStrict: (zone: string) => void }) {
  const mode = zoneSslMode(zone, hostnames)
  return (
    <span className="inline-flex items-center gap-2 text-xs text-nd-text-muted">
      SSL mode: {modeLabel(mode)}
      {offersStrict(mode) && (
        <Button size="sm" aria-label={`Set ${zone} to ${STRICT_LABEL}`} onClick={() => onSetStrict(zone)}>Set to {STRICT_LABEL}</Button>
      )}
    </span>
  )
}

export function ZoneList({ zones, hostnames, onSetStrict }: ZoneListProps) {
  const warning = outsideZonesWarning(hostnamesOutsideZones(hostnames))
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-nd-text-muted">Zones this token can see</span>
      {zones.length === 0 ? (
        <span className="text-xs text-nd-text-muted">This token cannot see any zone. Include the zones you want checked when you create it.</span>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {zoneCoverage(zones, hostnames).map(({ zone, hostnames: count }) => (
            <div key={zone.id} className="inline-flex items-center gap-2">
              <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-nd-bg-primary px-2 font-mono text-xs text-nd-text-secondary">
                <Check size={12} strokeWidth={2.6} className="text-nd-success" />
                {zone.name} · {hostnameCount(count)}
              </span>
              <ZoneModeControl zone={zone.name} hostnames={hostnames} onSetStrict={onSetStrict} />
            </div>
          ))}
        </div>
      )}
      {warning && <span className="text-xs text-nd-warning">{warning}</span>}
    </div>
  )
}
