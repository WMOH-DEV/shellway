import { useMemo } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Tooltip } from '@/components/ui/Tooltip'
import type { AttentionItem, AttentionLevel, ServerSection } from '@/types/server/core'
import type { ConnectionStatus } from '@/types/session'
import { SECTIONS } from '../sections/registry'
import type { SectionModule } from '../sections/types'
import { CHIP_TONE, DOT_TONE, StatusDot } from '../kit'
import { countsByArea, worstLevel } from '../useServerAttention'
import { connectionTone, IdentityBlock } from './IdentityBlock'

interface Badge {
  count: number
  level: AttentionLevel
}

type Badges = Partial<Record<ServerSection, Badge>>

const MAIN_SECTIONS = SECTIONS.filter((section) => section.placement === 'main')
const BOTTOM_SECTIONS = SECTIONS.filter((section) => section.placement === 'bottom')

function badgesFor(items: readonly AttentionItem[]): Badges {
  const badges: Badges = {}
  for (const [area, count] of Object.entries(countsByArea(items)) as [ServerSection, number][]) {
    const level = worstLevel(items.filter((item) => item.area === area))
    if (level) badges[area] = { count, level }
  }
  return badges
}

function NavLink({ section, selected, badge, collapsed, onSelect }: {
  section: SectionModule
  selected: boolean
  badge: Badge | undefined
  collapsed: boolean
  onSelect: () => void
}) {
  const Icon = section.icon
  const link = (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'page' : undefined}
      aria-label={collapsed ? section.label : undefined}
      className={cn(
        'relative flex h-[34px] w-full items-center gap-2.5 rounded-[7px] text-[13px] transition-colors',
        collapsed ? 'justify-center px-0' : 'px-2.5',
        selected ? 'bg-nd-surface-raised font-medium text-nd-text-primary' : 'text-nd-text-secondary hover:bg-nd-surface hover:text-nd-text-primary'
      )}
    >
      <Icon size={16} className="shrink-0" />
      {!collapsed && <span className="truncate">{section.label}</span>}
      {badge && !collapsed && (
        <span className={cn('ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] text-[11px] font-semibold', CHIP_TONE[badge.level])}>
          {badge.count}
        </span>
      )}
      {badge && collapsed && <span className={cn('absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full', DOT_TONE[badge.level])} aria-hidden />}
    </button>
  )
  if (!collapsed) return link
  const tip = badge ? `${section.label} (${badge.count})` : section.label
  return <Tooltip content={tip} side="right" triggerClassName="w-full">{link}</Tooltip>
}

export interface ServerSubNavProps {
  connectionId: string
  active: boolean
  name: string
  status: ConnectionStatus
  section: ServerSection
  attention: readonly AttentionItem[]
  collapsed: boolean
  onSelect(section: ServerSection): void
  onToggleCollapsed(): void
}

function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle(): void }) {
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    <div className={cn('mt-1 flex border-t border-nd-border pt-2', collapsed ? 'justify-center' : 'justify-end')}>
      <Tooltip content={label} side="right">
        <button type="button" aria-label={label} onClick={onToggle} className="rounded-[7px] p-2 text-nd-text-muted transition-colors hover:bg-nd-surface hover:text-nd-text-primary">
          <Icon size={16} />
        </button>
      </Tooltip>
    </div>
  )
}

export function ServerSubNav({ connectionId, active, name, status, section, attention, collapsed, onSelect, onToggleCollapsed }: ServerSubNavProps) {
  const badges = useMemo(() => badgesFor(attention), [attention])
  const renderLink = (module: SectionModule) => (
    <NavLink
      key={module.id}
      section={module}
      selected={module.id === section}
      badge={badges[module.id]}
      collapsed={collapsed}
      onSelect={() => onSelect(module.id)}
    />
  )

  return (
    <nav
      aria-label="Server sections"
      className={cn('flex shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-nd-border bg-nd-bg-secondary py-4', collapsed ? 'w-14 px-2' : 'w-[232px] px-3')}
    >
      {collapsed ? (
        <Tooltip content={name} side="right" triggerClassName="flex justify-center pb-3.5 pt-1">
          <StatusDot tone={connectionTone(status)} label={status} />
        </Tooltip>
      ) : (
        <IdentityBlock connectionId={connectionId} active={active} name={name} status={status} />
      )}
      {MAIN_SECTIONS.map(renderLink)}
      <div className="flex-1" />
      {BOTTOM_SECTIONS.map(renderLink)}
      <CollapseToggle collapsed={collapsed} onToggle={onToggleCollapsed} />
    </nav>
  )
}
