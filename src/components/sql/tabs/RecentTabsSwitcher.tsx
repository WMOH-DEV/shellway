import type { SQLTab } from '@/types/sql'
import { useSqlTabSnapshot } from '@/stores/sqlTabSnapshotStore'
import { kindBarClass, kindLabel, relativeTime, tabTitle } from './tabPresentation'
import { mruTabs, tabKind } from './tabModel'
import { getDatabaseTabs } from './useDatabaseTabs'
import { useRecentSwitcher } from './useRecentSwitcher'

interface RecentTabsSwitcherProps {
  connectionId: string
  enabled: boolean
  onCommit: (tabId: string) => void
}

function agoText(tab: SQLTab, now: number): string {
  const elapsed = relativeTime(tab.lastActiveAt, now)
  return elapsed === 'now' || elapsed === 'yesterday' || elapsed === '' ? elapsed : `${elapsed} ago`
}

function rowMeta(tab: SQLTab, index: number, now: number): string {
  const status = index === 0 ? 'current' : tab.pinned ? 'pinned' : null
  const parts = status
    ? [tab.database, status]
    : [tab.database, tab.isDirty ? 'unsaved' : '', agoText(tab, now)]
  return parts.filter(Boolean).join(' · ')
}

function previewSummary(tab: SQLTab, totalRows: number | undefined): string {
  const rows = totalRows !== undefined ? `${totalRows.toLocaleString()} rows` : undefined
  return [tab.database, kindLabel(tabKind(tab)), rows].filter(Boolean).join(' · ')
}

interface SwitcherRowProps {
  tab: SQLTab
  index: number
  highlighted: boolean
  now: number
  onHover: () => void
  onPick: () => void
}

function SwitcherRow({ tab, index, highlighted, now, onHover, onPick }: SwitcherRowProps) {
  return (
    <div
      role="option"
      aria-selected={highlighted}
      onMouseMove={onHover}
      onClick={onPick}
      className={`h-10 flex items-center gap-2 px-2 rounded-md cursor-pointer ${
        highlighted ? 'bg-nd-accent/15 ring-1 ring-inset ring-nd-accent' : ''
      }`}
    >
      <span className={`w-[3px] h-6 rounded-full ${kindBarClass(tabKind(tab))}`} />
      <span className="flex-1 min-w-0 flex flex-col leading-tight">
        <span className="truncate text-nd-text-primary">{tabTitle(tab)}</span>
        <span className="truncate text-[11px] text-nd-text-muted">{rowMeta(tab, index, now)}</span>
      </span>
      {index > 0 && (
        <kbd className="rounded border border-nd-border px-1 font-mono text-[11px] text-nd-text-muted">{index}</kbd>
      )}
    </div>
  )
}

function PreviewPane({ tab }: { tab: SQLTab | undefined }) {
  const snapshot = useSqlTabSnapshot(tab?.id)
  if (!tab) return null
  const filterLine = [
    snapshot?.filterSummary && `Filter: ${snapshot.filterSummary}`,
    snapshot?.sortSummary && `sorted by ${snapshot.sortSummary}`
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex-1 p-3 flex flex-col gap-2 min-w-0">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-nd-text-dim">Preview</span>
      <span className="text-sm font-medium text-nd-text-primary truncate">{tabTitle(tab)}</span>
      <span className="text-nd-text-muted">{previewSummary(tab, snapshot?.totalRows)}</span>
      {filterLine && <span className="text-nd-text-muted">{filterLine}</span>}
      {snapshot && snapshot.sampleRows.length > 0 && (
        <div className="font-mono text-[11px] rounded-md border border-nd-border bg-nd-bg-sunken p-2 text-nd-text-secondary">
          {snapshot.sampleRows.map((line, i) => (
            <div key={i} className="truncate">
              {line}
            </div>
          ))}
        </div>
      )}
      {!snapshot && <span className="text-nd-text-muted">No cached rows yet</span>}
    </div>
  )
}

export function RecentTabsSwitcher({ connectionId, enabled, onCommit }: RecentTabsSwitcherProps) {
  const switcher = useRecentSwitcher({
    enabled,
    onCommit,
    getRows: () => mruTabs(getDatabaseTabs(connectionId))
  })

  if (!switcher.open) return null
  const now = Date.now()

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <div className="absolute inset-0 bg-black/30" onMouseDown={switcher.cancel} />
      <div
        role="dialog"
        aria-label="Recent tabs"
        className="relative w-[640px] rounded-lg border border-nd-border bg-nd-surface shadow-xl flex flex-col text-xs"
      >
        <div className="flex">
          <div className="w-[300px] border-r border-nd-border p-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-nd-text-dim px-2 pb-1">
              Recent tabs
            </div>
            <div role="listbox" aria-label="Recent tabs list">
              {switcher.rows.map((tab, index) => (
                <SwitcherRow
                  key={tab.id}
                  tab={tab}
                  index={index}
                  highlighted={index === switcher.highlight}
                  now={now}
                  onHover={() => switcher.setHighlight(index)}
                  onPick={() => switcher.commit(index)}
                />
              ))}
            </div>
          </div>
          <PreviewPane tab={switcher.rows[switcher.highlight]} />
        </div>
        <div className="border-t border-nd-border px-3 h-8 flex items-center text-nd-text-muted">
          ⌃ hold, Tab next, ⇧Tab back, 1–6 jump, release to open
        </div>
      </div>
    </div>
  )
}
