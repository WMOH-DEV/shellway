import { Copy } from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import { cn } from '@/utils/cn'
import { infoCopyText, type InfoRow } from '@/utils/server/overview/serverInfo'
import { Label, SectionCard } from '../../kit'

export function ServerInfoCard({ rows }: { rows: InfoRow[] }) {
  const copyAll = () => void navigator.clipboard.writeText(infoCopyText(rows)).then(() => toast.success('Server info copied'))
  const copyButton = (
    <button type="button" aria-label="Copy all" onClick={copyAll} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-nd-text-muted hover:bg-nd-surface-hover hover:text-nd-text-primary">
      <Copy size={15} />
    </button>
  )
  return (
    <SectionCard title="Server info" aside={copyButton}>
      <dl className="grid grid-cols-4 gap-x-5 gap-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex min-w-0 flex-col gap-[3px]">
            <dt><Label>{row.label}</Label></dt>
            <dd title={row.value} className={cn('truncate text-[13px] text-nd-text-primary', row.mono && 'font-mono text-[12.5px]')}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  )
}
