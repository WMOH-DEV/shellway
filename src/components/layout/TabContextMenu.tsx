import { useEffect, useRef, useState, useCallback } from 'react'
import { Columns, Rows, ArrowRightLeft, X, XCircle } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useConnectionStore } from '@/stores/connectionStore'
import type { LucideIcon } from 'lucide-react'

interface TabContextMenuProps {
  tabId: string
  x: number
  y: number
  onClose: () => void
}

interface MenuItem {
  label: string
  icon: LucideIcon
  onClick: () => void
  disabled?: boolean
}

export function TabContextMenu({ tabId, x, y, onClose }: TabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x, y })

  const panes = useConnectionStore(s => s.panes)
  const splitPane = useConnectionStore(s => s.splitPane)
  const moveTabToPane = useConnectionStore(s => s.moveTabToPane)
  const removeTab = useConnectionStore(s => s.removeTab)
  const closeOtherTabs = useConnectionStore(s => s.closeOtherTabs)

  const totalTabs = panes.reduce((sum, p) => sum + p.tabIds.length, 0)
  const isSplit = panes.length >= 2
  const sourcePane = panes.find(p => p.tabIds.includes(tabId))
  const otherPane = panes.find(p => p.id !== sourcePane?.id)

  // Clamp menu position to viewport edges
  useEffect(() => {
    const el = menuRef.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    let clampedX = x
    let clampedY = y

    if (x + rect.width > window.innerWidth) {
      clampedX = window.innerWidth - rect.width - 4
    }
    if (y + rect.height > window.innerHeight) {
      clampedY = window.innerHeight - rect.height - 4
    }

    if (clampedX !== x || clampedY !== y) {
      setPosition({ x: clampedX, y: clampedY })
    }
  }, [x, y])

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleAction = useCallback((action: () => void) => {
    action()
    onClose()
  }, [onClose])

  // Build split/move items
  const splitItems: MenuItem[] = isSplit
    ? [
        {
          label: 'Move to Other Pane',
          icon: ArrowRightLeft,
          onClick: () => handleAction(() => otherPane && moveTabToPane(tabId, otherPane.id)),
          disabled: !sourcePane || sourcePane.tabIds.length <= 1,
        },
      ]
    : [
        {
          label: 'Split Right',
          icon: Columns,
          onClick: () => handleAction(() => splitPane(tabId, 'horizontal')),
          disabled: totalTabs <= 1,
        },
        {
          label: 'Split Down',
          icon: Rows,
          onClick: () => handleAction(() => splitPane(tabId, 'vertical')),
          disabled: totalTabs <= 1,
        },
      ]

  const closeItems: MenuItem[] = [
    {
      label: 'Close Tab',
      icon: X,
      onClick: () => handleAction(() => removeTab(tabId)),
    },
    {
      label: 'Close Other Tabs',
      icon: XCircle,
      onClick: () => handleAction(() => closeOtherTabs(tabId)),
      disabled: totalTabs <= 1,
    },
  ]

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-nd-bg-secondary border border-nd-border rounded-lg shadow-xl py-1 min-w-[180px] animate-fade-in"
      style={{ left: position.x, top: position.y }}
    >
      {splitItems.map(item => (
        <MenuItemButton key={item.label} item={item} />
      ))}
      <div className="h-px bg-nd-border my-1 mx-2" />
      {closeItems.map(item => (
        <MenuItemButton key={item.label} item={item} />
      ))}
    </div>
  )
}

function MenuItemButton({ item }: { item: MenuItem }) {
  const Icon = item.icon
  return (
    <button
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-nd-text-secondary',
        item.disabled
          ? 'opacity-40 cursor-not-allowed'
          : 'hover:bg-nd-surface hover:text-nd-text-primary'
      )}
      onClick={item.disabled ? undefined : item.onClick}
      disabled={item.disabled}
    >
      <Icon size={14} />
      {item.label}
    </button>
  )
}
