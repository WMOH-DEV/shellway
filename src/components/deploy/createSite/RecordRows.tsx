import type { DnsRecordPlan } from '@/types/createSite'

export function RecordRows({ records }: { records: DnsRecordPlan[] }) {
  return (
    <div role="table" aria-label="DNS records" className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-5 gap-y-1 rounded-lg border border-nd-border bg-nd-bg-sunken px-3 py-2 font-mono text-xs text-nd-text-secondary">
      {records.map((record) => (
        <div role="row" key={`${record.type} ${record.name}`} className="contents">
          <span role="cell">{record.type}</span>
          <span role="cell" className="truncate" title={record.name}>{record.name}</span>
          <span role="cell" className="truncate" title={record.content}>{record.content}</span>
          <span role="cell" className="text-nd-text-muted">{record.proxied ? 'proxied' : 'DNS only'}</span>
        </div>
      ))}
    </div>
  )
}
