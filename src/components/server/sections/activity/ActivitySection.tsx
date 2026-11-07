import { useEffect, useMemo, useState } from 'react'
import { Download, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import type { ActivityEntry } from '@/types/server/core'
import { groupByDay } from '@/utils/server/activity/format'
import { countFailed, matchesView, type ActivityAreaFilter, type ActivityFilter, type ActivityView } from '@/utils/server/activity/filter'
import type { ActivityExportFormat } from '@/utils/server/activity/export'
import { useActionLauncher } from '../../action'
import { Notice, PageHeader, SectionPage, Segmented, type SegmentOption } from '../../kit'
import type { ServerSectionContext } from '../types'
import { ActivityRow } from './ActivityRow'
import { exportActivity } from './exportActivity'
import { useActivity } from './useActivity'

const AREA_OPTIONS: SegmentOption<ActivityAreaFilter>[] = [
  { value: 'any', label: 'Any area' },
  { value: 'sites', label: 'Sites' },
  { value: 'software', label: 'Software' },
  { value: 'services', label: 'Services' },
  { value: 'docker', label: 'Docker' },
  { value: 'databases', label: 'Databases' },
  { value: 'jobs', label: 'Cron' },
  { value: 'security', label: 'Security' }
]

const EXPORT_ITEMS = [
  { id: 'json', label: 'Export as JSON' },
  { id: 'txt', label: 'Export as plain text' }
]

const SEARCH_DELAY_MS = 250

export function ActivitySection({ ctx }: { ctx: ServerSectionContext }) {
  const [view, setView] = useState<ActivityView>('all')
  const [area, setArea] = useState<ActivityAreaFilter>('any')
  const [search, setSearch] = useState('')
  const text = useDebounced(search, SEARCH_DELAY_MS)
  const filter = useMemo<ActivityFilter>(() => ({ view, area, text }), [view, area, text])
  const activity = useActivity(ctx, filter)
  const [openId, setOpenId] = useState<string | null>(null)
  const launcher = useActionLauncher(ctx)

  const visible = useMemo(() => activity.entries.filter((entry) => matchesView(entry, view)), [activity.entries, view])
  const days = useMemo(() => groupByDay(visible, Date.now()), [visible])
  const viewOptions = useMemo(() => viewSegments(countFailed(activity.entries)), [activity.entries])

  const undo = (entry: ActivityEntry) => {
    if (!entry.undo) return
    launcher.launch({ type: entry.undo.type, params: entry.undo.params, onFinished: activity.refresh })
  }

  return (
    <SectionPage>
      <PageHeader
        title="Activity"
        subtitle="Every change made from the Server tab, and every automatic deploy, with the exact commands and output."
        actions={
          <Dropdown
            align="right"
            trigger={<Button><Download size={14} />Export</Button>}
            items={EXPORT_ITEMS}
            onSelect={(format) => void exportActivity(ctx.sessionId, ctx.sessionName, filter, format as ActivityExportFormat)}
          />
        }
      />
      <div className="flex flex-wrap items-center gap-2.5">
        <Segmented<ActivityView> ariaLabel="Who and status" options={viewOptions} value={view} onChange={setView} />
        <Segmented<ActivityAreaFilter> ariaLabel="Area" options={AREA_OPTIONS} value={area} onChange={setArea} />
        <div className="w-60">
          <Input aria-label="Search activity" placeholder="Search" icon={<Search size={14} />} value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
      </div>
      {activity.error && <Notice tone="error" title="Could not read the activity log">{activity.error}</Notice>}
      <section aria-label="Activity log" className="overflow-hidden rounded-xl border border-nd-border bg-nd-surface">
        {days.map((day) => (
          <div key={day.key}>
            <div className="border-b border-nd-border bg-nd-bg-sunken px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-nd-text-dim">{day.label}</div>
            {day.entries.map((entry) => (
              <ActivityRow
                key={entry.id}
                entry={entry}
                open={openId === entry.id}
                canUndo={ctx.connectionStatus === 'connected'}
                onToggle={() => setOpenId(openId === entry.id ? null : entry.id)}
                onUndo={undo}
              />
            ))}
          </div>
        ))}
        {days.length === 0 && <EmptyState loading={activity.loading} filtered={view !== 'all' || area !== 'any' || text !== ''} />}
      </section>
      {activity.hasMore && (
        <Button className="self-center" disabled={activity.loading} onClick={activity.loadOlder}>
          {activity.loading ? <Spinner size="sm" /> : null}
          Show older
        </Button>
      )}
    </SectionPage>
  )
}

function EmptyState({ loading, filtered }: { loading: boolean; filtered: boolean }) {
  if (loading) {
    return <div className="flex items-center gap-2 px-4 py-6 text-[13px] text-nd-text-muted"><Spinner size="sm" />Reading the activity log…</div>
  }
  return <p className="px-4 py-6 text-[13px] text-nd-text-muted">{filtered ? 'Nothing matches these filters.' : 'Nothing has been done on this server from Shellway yet.'}</p>
}

function viewSegments(failed: number): SegmentOption<ActivityView>[] {
  return [
    { value: 'all', label: 'All' },
    { value: 'failed', label: 'Failed', count: failed, alarm: true },
    { value: 'you', label: 'By me' },
    { value: 'auto', label: 'Automatic' }
  ]
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return settled
}
