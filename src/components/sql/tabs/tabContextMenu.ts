import type { ContextMenuItem } from '@/components/ui/ContextMenu'
import type { SQLTab } from '@/types/sql'
import type { TabActions } from './tabActions'

export type TabMenuAction =
  | 'pin'
  | 'duplicate'
  | 'close'
  | 'close-others'
  | 'close-right'
  | 'close-unpinned'
  | 'copy-name'
  | 'reveal'

function unpinnedIds(tabs: SQLTab[]): string[] {
  return tabs.filter((t) => !t.pinned).map((t) => t.id)
}

function otherUnpinnedIds(tab: SQLTab, tabs: SQLTab[]): string[] {
  return unpinnedIds(tabs).filter((id) => id !== tab.id)
}

function unpinnedToTheRight(tab: SQLTab, tabs: SQLTab[]): string[] {
  const index = tabs.findIndex((t) => t.id === tab.id)
  return unpinnedIds(tabs.slice(index + 1))
}

export function buildTabContextMenu(tab: SQLTab, tabs: SQLTab[]): ContextMenuItem[] {
  return [
    { id: 'pin', label: tab.pinned ? 'Unpin' : 'Pin' },
    { id: 'duplicate', label: 'Duplicate' },
    { id: 'sep-1', label: '', separator: true },
    { id: 'close', label: 'Close' },
    { id: 'close-others', label: 'Close others', disabled: otherUnpinnedIds(tab, tabs).length === 0 },
    { id: 'close-right', label: 'Close to the right', disabled: unpinnedToTheRight(tab, tabs).length === 0 },
    { id: 'close-unpinned', label: 'Close unpinned', disabled: unpinnedIds(tabs).length === 0 },
    { id: 'sep-2', label: '', separator: true },
    { id: 'copy-name', label: 'Copy name' },
    { id: 'reveal', label: 'Reveal in sidebar', disabled: tab.type === 'query' }
  ]
}

export function runTabContextAction(action: string, tab: SQLTab, tabs: SQLTab[], actions: TabActions): void {
  switch (action as TabMenuAction) {
    case 'pin':
      return actions.pin(tab.id, !tab.pinned)
    case 'duplicate':
      return actions.duplicate(tab.id)
    case 'close':
      return actions.close(tab.id)
    case 'close-others':
      return actions.closeMany(otherUnpinnedIds(tab, tabs))
    case 'close-right':
      return actions.closeMany(unpinnedToTheRight(tab, tabs))
    case 'close-unpinned':
      return actions.closeMany(unpinnedIds(tabs))
    case 'copy-name':
      return actions.copyName(tab.id)
    case 'reveal':
      return actions.revealInSidebar(tab.id)
  }
}
