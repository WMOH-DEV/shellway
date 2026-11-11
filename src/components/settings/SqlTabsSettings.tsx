import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { Select } from '@/components/ui/Select'
import { Toggle } from '@/components/ui/Toggle'
import { useKeybindingStore } from '@/stores/keybindingStore'
import { formatCombo } from '@/utils/keybindings'
import type { AppSettings, SqlNewTabPosition, SqlTabLayout } from '@/types/settings'

type BooleanSettingKey = {
  [K in keyof AppSettings]: AppSettings[K] extends boolean ? K : never
}[keyof AppSettings]

type UpdateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void

interface SqlTabsSettingsProps {
  settings: AppSettings
  update: UpdateSetting
  onOpenShortcuts: () => void
}

type BarTone = 'accent' | 'success' | 'neutral'

interface PreviewBar {
  width: string
  tone: BarTone
}

interface LayoutCard {
  value: SqlTabLayout
  title: string
  description: string
  direction: 'row' | 'column'
  bars: PreviewBar[]
}

const LAYOUT_CARDS: LayoutCard[] = [
  {
    value: 'single',
    title: 'Single row',
    description: 'Scrolls, with the "N tabs" menu for the rest. Default.',
    direction: 'row',
    bars: [
      { width: '18%', tone: 'accent' },
      { width: '22%', tone: 'success' },
      { width: '20%', tone: 'neutral' },
      { width: '22%', tone: 'neutral' },
      { width: '14%', tone: 'neutral' }
    ]
  },
  {
    value: 'vertical',
    title: 'Vertical list',
    description: 'Open tabs in the sidebar, grouped. Best for many tabs.',
    direction: 'column',
    bars: [
      { width: '40%', tone: 'accent' },
      { width: '55%', tone: 'neutral' },
      { width: '48%', tone: 'neutral' },
      { width: '60%', tone: 'success' },
      { width: '45%', tone: 'neutral' },
      { width: '50%', tone: 'neutral' }
    ]
  }
]

const BAR_TONE_CLASS: Record<BarTone, string> = {
  accent: 'bg-nd-accent',
  success: 'bg-nd-success',
  neutral: 'bg-nd-surface-raised'
}

const TAB_LIMIT_OPTIONS = [
  { value: '10', label: '10 tabs' },
  { value: '15', label: '15 tabs' },
  { value: '20', label: '20 tabs' },
  { value: '30', label: '30 tabs' },
  { value: '0', label: 'No limit' }
]

const NEW_TAB_POSITION_OPTIONS: { value: SqlNewTabPosition; label: string }[] = [
  { value: 'next', label: 'Next to current' },
  { value: 'end', label: 'At the end' }
]

const SHORTCUTS: { title: string; actionIds: string[]; separator: string }[] = [
  { title: 'Go to tab (search)', actionIds: ['sql:tabMenu'], separator: '' },
  { title: 'Recent tabs switcher', actionIds: ['sql:recentTabs'], separator: '' },
  { title: 'Next / previous tab', actionIds: ['sql:nextTab', 'sql:prevTab'], separator: ' / ' },
  { title: 'Go to tab 1–9', actionIds: ['sql:goToTab1', 'sql:goToLastTab'], separator: ' … ' },
  { title: 'Pin / unpin tab', actionIds: ['sql:pinTab'], separator: '' },
  { title: 'Reopen closed tab', actionIds: ['sql:reopenClosedTab'], separator: '' },
  { title: 'Close tab', actionIds: ['sql:closeTab'], separator: '' },
  { title: 'Close other tabs', actionIds: ['sql:closeOtherTabs'], separator: '' }
]

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wider text-nd-text-dim">
      {children}
    </span>
  )
}

function LayoutPreview({ direction, bars }: Pick<LayoutCard, 'direction' | 'bars'>) {
  const isRow = direction === 'row'
  return (
    <div
      className={cn(
        'w-full h-14 rounded-md bg-nd-bg-sunken p-2 flex gap-1 overflow-hidden',
        isRow ? 'flex-row' : 'flex-col'
      )}
    >
      {bars.map((bar, index) => (
        <span
          key={index}
          className={cn('shrink-0 rounded-sm', isRow ? 'h-3.5' : 'h-2.5', BAR_TONE_CLASS[bar.tone])}
          style={{ width: bar.width }}
        />
      ))}
    </div>
  )
}

function LayoutPicker({
  value,
  onChange
}: {
  value: SqlTabLayout
  onChange: (layout: SqlTabLayout) => void
}) {
  return (
    <div role="radiogroup" aria-label="Tab layout" className="grid grid-cols-2 gap-2">
      {LAYOUT_CARDS.map((card) => {
        const isSelected = card.value === value
        return (
          <button
            key={card.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(card.value)}
            className={cn(
              'flex flex-col gap-2 p-3 rounded-lg text-left border',
              isSelected
                ? 'border-nd-accent bg-nd-accent/10'
                : 'border-nd-border bg-nd-surface hover:border-nd-border-hover'
            )}
          >
            <LayoutPreview direction={card.direction} bars={card.bars} />
            <span className="text-xs font-medium text-nd-text-primary">{card.title}</span>
            <span className="text-2xs text-nd-text-muted">{card.description}</span>
          </button>
        )
      })}
    </div>
  )
}

function OptionRow({
  title,
  description,
  children
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-t border-nd-border">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-nd-text-primary">{title}</span>
        {description && <span className="text-2xs text-nd-text-muted">{description}</span>}
      </div>
      {children}
    </div>
  )
}

function ShortcutList({ onOpenShortcuts }: { onOpenShortcuts: () => void }) {
  const bindings = useKeybindingStore((state) => state.bindings)
  const formatShortcut = (actionIds: string[], separator: string) =>
    actionIds.map((id) => formatCombo(bindings[id] ?? '')).join(separator)

  return (
    <>
      <div className="grid grid-cols-2 gap-x-6">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.title} className="flex justify-between py-1.5 text-xs">
            <span className="text-nd-text-primary">{shortcut.title}</span>
            <kbd className="rounded border border-nd-border px-1.5 font-mono text-[11px] text-nd-text-muted">
              {formatShortcut(shortcut.actionIds, shortcut.separator)}
            </kbd>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onOpenShortcuts}
        className="self-start text-xs text-nd-accent hover:text-nd-accent-hover"
      >
        Change in Shortcuts
      </button>
    </>
  )
}

export function SqlTabsSettings({ settings, update, onOpenShortcuts }: SqlTabsSettingsProps) {
  const renderToggle = (title: string, key: BooleanSettingKey, description?: string) => (
    <OptionRow title={title} description={description}>
      <Toggle ariaLabel={title} checked={settings[key]} onChange={(checked) => update(key, checked)} />
    </OptionRow>
  )

  return (
    <div>
      <h3 className="text-sm font-semibold text-nd-text-primary mb-4">Tabs</h3>
      <div className="flex flex-col gap-3">
        <GroupLabel>Layout</GroupLabel>
        <LayoutPicker value={settings.sqlTabLayout} onChange={(layout) => update('sqlTabLayout', layout)} />
        <div className="flex flex-col">
          {renderToggle(
            'Preview tabs',
            'sqlPreviewTabs',
            'Single-click opens a table in a preview tab (italic) that the next click replaces. Double-click, filter or edit keeps it.'
          )}
          <OptionRow
            title="Limit open tabs"
            description="When the limit is reached, the least recently used unpinned, saved tab closes. Unsaved queries never close on their own."
          >
            <div className="w-36 shrink-0">
              <Select
                aria-label="Limit open tabs"
                value={String(settings.sqlTabLimit)}
                onChange={(event) => update('sqlTabLimit', Number(event.target.value))}
                options={TAB_LIMIT_OPTIONS}
              />
            </div>
          </OptionRow>
          <OptionRow title="Open new tabs" description="Where a new tab appears in the row.">
            <div className="w-36 shrink-0">
              <Select
                aria-label="Open new tabs"
                value={settings.sqlNewTabPosition}
                onChange={(event) => update('sqlNewTabPosition', event.target.value as SqlNewTabPosition)}
                options={NEW_TAB_POSITION_OPTIONS}
              />
            </div>
          </OptionRow>
          {renderToggle(
            'Colour by kind',
            'sqlColorByKind',
            'Table, query and structure tabs get a coloured marker.'
          )}
          {renderToggle(
            'Reopen tabs on connect',
            'sqlReopenTabsOnConnect',
            'Restores the tabs, filters and scroll position from last time.'
          )}
          {renderToggle('Close with middle click', 'sqlCloseOnMiddleClick')}
        </div>
        <GroupLabel>Shortcuts</GroupLabel>
        <ShortcutList onOpenShortcuts={onOpenShortcuts} />
      </div>
    </div>
  )
}
