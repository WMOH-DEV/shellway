import { useState } from 'react'
import { Pause, Play, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { logSources } from '@/utils/server/sites/logSources'
import { Notice, Segmented } from '../../../kit'
import type { SitePageProps } from '../SiteDetailPage'
import { LogText } from './LogText'
import { useSiteLog } from './useSiteLog'

const TAB_LINES = 300

export function LogsTab({ page }: { page: SitePageProps }) {
  const { data, entry, ctx } = page
  const options = logSources(entry, data.inventory)
  const [selected, setSelected] = useState(options[0]?.id ?? '')
  const [follow, setFollow] = useState(false)
  const option = options.find((o) => o.id === selected) ?? options[0]
  const log = useSiteLog(data.connectionId, entry.summary.config.name, option, TAB_LINES, follow && ctx.active)

  if (options.length === 0) {
    return <Notice tone="neutral" title="No logs to show">Shellway found no web server site for this folder and no app log it knows.</Notice>
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented ariaLabel="Log file" options={options.map((o) => ({ value: o.id, label: o.label }))} value={option?.id ?? ''} onChange={setSelected} />
        <span className="truncate font-mono text-xs text-nd-text-muted">{option?.file}</span>
        <div className="flex-1" />
        <Button size="sm" onClick={log.reload} disabled={log.loading}><RefreshCw size={13} className={log.loading ? 'animate-spin' : undefined} /> Refresh</Button>
        <Button size="sm" variant={follow ? 'primary' : 'secondary'} onClick={() => setFollow((on) => !on)} aria-pressed={follow}>
          {follow ? <Pause size={13} /> : <Play size={13} />} {follow ? 'Following' : 'Follow'}
        </Button>
      </div>
      <LogText log={log} className="min-h-0 flex-1" />
    </div>
  )
}
