import { cn } from '@/utils/cn'

export interface TabItem {
  id: string
  label: string
  icon?: React.ReactNode
  disabled?: boolean
}

interface TabsProps {
  tabs: TabItem[]
  activeTab: string
  onTabChange: (id: string) => void
  className?: string
  size?: 'sm' | 'md'
}

export function Tabs({ tabs, activeTab, onTabChange, className, size = 'md' }: TabsProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 border-b border-nd-border',
        className
      )}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => !tab.disabled && onTabChange(tab.id)}
          disabled={tab.disabled}
          className={cn(
            'relative inline-flex items-center gap-1.5 px-3 font-medium transition-colors duration-150',
            'border-b-2 -mb-px',
            size === 'sm' ? 'py-1.5 text-xs' : 'py-2 text-sm',
            activeTab === tab.id
              ? 'border-nd-accent text-nd-accent'
              : 'border-transparent text-nd-text-muted hover:text-nd-text-secondary',
            tab.disabled && 'opacity-40 cursor-not-allowed'
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  )
}
