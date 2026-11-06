import { Check } from 'lucide-react'
import type { CloudflareStatus, HostnameStatus } from '@/types/ssl'
import { hostnameCount, hostnamesOutsideZones, outsideZonesWarning, zoneCoverage } from '@/utils/ssl/settingsZones'

interface ZoneListProps {
  zones: CloudflareStatus['zones']
  hostnames: HostnameStatus[]
}

export function ZoneList({ zones, hostnames }: ZoneListProps) {
  const warning = outsideZonesWarning(hostnamesOutsideZones(hostnames))
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-nd-text-muted">Zones this token can see</span>
      {zones.length === 0 ? (
        <span className="text-xs text-nd-text-muted">This token cannot see any zone. Include the zones you want checked when you create it.</span>
      ) : (
        <div className="flex flex-wrap gap-2">
          {zoneCoverage(zones, hostnames).map(({ zone, hostnames: count }) => (
            <span key={zone.id} className="inline-flex h-6 items-center gap-1.5 rounded-md bg-nd-bg-primary px-2 font-mono text-xs text-nd-text-secondary">
              <Check size={12} strokeWidth={2.6} className="text-nd-success" />
              {zone.name} · {hostnameCount(count)}
            </span>
          ))}
        </div>
      )}
      {warning && <span className="text-xs text-nd-warning">{warning}</span>}
    </div>
  )
}
