import type { DoctorReport } from '@/types/deploy'
import { shortPath } from '@/utils/deploy/siteRow'
import { SidePanel } from './SidePanel'

interface RunsAsPanelProps {
  report: DoctorReport | null
  loading: boolean
  path: string
  onOpenServerCheck: () => void
}

function sudoLine(report: DoctorReport): string | null {
  const missing = report.sudoNeeds.length
  if (missing === 0) return null
  return `${missing} ${missing === 1 ? 'command needs' : 'commands need'} a sudoers line`
}

export function RunsAsPanel({ report, loading, path, onOpenServerCheck }: RunsAsPanelProps) {
  const user = report?.user ?? ''
  const warning = report ? sudoLine(report) : null
  return (
    <SidePanel title="Runs as">
      <div className="flex flex-wrap items-center gap-2 text-xs text-nd-text-muted">
        <span className="font-mono text-[12.5px] text-nd-text-primary">{user || (loading ? '…' : 'unknown user')}</span>
        <span>in</span>
        <span title={path} className="min-w-0 truncate font-mono text-[12.5px] text-nd-text-secondary">{shortPath(path, user)}</span>
      </div>
      {warning && (
        <span className="flex items-center gap-1.5 text-xs text-nd-warning-fg">
          <span className="h-1.5 w-1.5 rounded-full bg-nd-warning" />
          {warning}
        </span>
      )}
      <button type="button" className="self-start text-xs text-nd-info-fg hover:underline" onClick={onOpenServerCheck}>
        Open server check
      </button>
    </SidePanel>
  )
}
