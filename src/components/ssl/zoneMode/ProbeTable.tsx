import type { ZoneHostProbe } from '@/types/ssl'
import { probeView, sortedProbes } from '@/utils/ssl/zoneMode/zoneModeView'
import { ProbeChip, SectionLabel } from './Chips'

const HEADERS = ['Hostname', 'Record', 'State']

export function ProbeTable({ zone, hosts }: { zone: string; hosts: ZoneHostProbe[] }) {
  if (hosts.length === 0) {
    return <p className="text-[13px] text-nd-text-muted">{zone} has no proxied hostnames to check.</p>
  }
  return (
    <section aria-label="Proxied hostnames" className="overflow-hidden rounded-[10px] border border-nd-border bg-nd-surface">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-nd-border">
            {HEADERS.map((header) => <th key={header} scope="col" className="px-3.5 py-2.5 font-normal"><SectionLabel>{header}</SectionLabel></th>)}
          </tr>
        </thead>
        <tbody>
          {sortedProbes(hosts).map((host) => (
            <tr key={`${host.name}|${host.recordType}|${host.origin}`} className="border-b border-nd-border last:border-b-0">
              <td className="px-3.5 py-2.5 align-top font-mono text-[12.5px] text-nd-text-primary">{host.name}</td>
              <td className="px-3.5 py-2.5 align-top">
                <span className="text-xs text-nd-text-muted">{host.recordType}</span>{' '}
                <span className="font-mono text-[12.5px] text-nd-text-secondary">{host.origin}</span>
              </td>
              <td className="px-3.5 py-2.5 align-top"><ProbeChip view={probeView(host)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
