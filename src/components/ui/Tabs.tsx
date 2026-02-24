import { X } from 'lucide-react'
import { cn } from '@/utils/cn'

export interface TabItem {
  id: string
  label: string
  icon?: React.ReactNode
  disabled?: boolean
  /** Visual dimming without disabling click — used for shut-down sub-tabs */
  dimmed?: boolean
}

interface TabsProps {
  tabs: TabItem[]
  activeTab: string
  onTabChange: (id: string) => void
  /** When provided, shows a close (X) button on active/hovered tabs */
  onTabClose?: (id: string) => void
  className?: string
  size?: 'sm' | 'md'
}

export function Tabs({ tabs, activeTab, onTabChange, onTabClose, className, size = 'md' }: TabsProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 border-b border-nd-border',
        className
      )}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id
        const isDimmed = tab.dimmed && !isActive

        return (
          <button
            key={tab.id}
            onClick={() => !tab.disabled && onTabChange(tab.id)}
            disabled={tab.disabled}
            className={cn(
              'group relative inline-flex items-center gap-1.5 px-3 font-medium transition-colors duration-150',
              'border-b-2 -mb-px',
              size === 'sm' ? 'py-1.5 text-xs' : 'py-2 text-sm',
              isActive
                ? 'border-nd-accent text-nd-accent'
                : 'border-transparent text-nd-text-muted hover:text-nd-text-secondary',
              tab.disabled && 'opacity-40 cursor-not-allowed',
              isDimmed && 'opacity-30'
            )}
          >
            {tab.icon}
            {tab.label}
            {onTabClose && !tab.disabled && !isDimmed && (
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onTabClose(tab.id)
                }}
                className={cn(
                  'ml-0.5 p-0.5 rounded transition-all shrink-0',
                  'hover:bg-nd-surface hover:text-red-400',
                  isActive
                    ? 'text-nd-text-muted/60'
                    : 'text-nd-text-muted/40 opacity-0 group-hover:opacity-100'
                )}
                title={`Shut down ${tab.label}`}
              >
                <X size={10} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
