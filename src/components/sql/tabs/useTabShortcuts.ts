import { useEffect, useRef } from 'react'
import { getBinding, matchesBinding } from '@/stores/keybindingStore'
import { CLOSE_REQUEST_EVENT } from '@/hooks/useKeyboardShortcuts'
import type { SQLTab } from '@/types/sql'
import type { TabActions } from './tabActions'
import { getDatabaseTabs } from './useDatabaseTabs'
import { isSearchOpen } from '@/stores/uiStore'

const MENU_CLOSE_COMBO = 'CmdOrCtrl+W'
const NUMBERED_TABS = 8

interface TabShortcutOptions {
  enabled: boolean
  connectionId: string
  actions: TabActions
  onOpenMenu: () => void
}

function tabsAndActive(connectionId: string): { tabs: SQLTab[]; active: SQLTab | undefined } {
  const { tabs, activeTabId } = getDatabaseTabs(connectionId)
  return { tabs, active: tabs.find((t) => t.id === activeTabId) }
}

function neighbourId(tabs: SQLTab[], activeId: string | undefined, step: number): string | undefined {
  if (tabs.length === 0) return undefined
  const index = tabs.findIndex((t) => t.id === activeId)
  return tabs[(index + step + tabs.length) % tabs.length].id
}

function numberedTabIndex(e: KeyboardEvent): number {
  for (let n = 1; n <= NUMBERED_TABS; n++) {
    if (matchesBinding(e, `sql:goToTab${n}`)) return n - 1
  }
  return -1
}

function runShortcut(e: KeyboardEvent, options: TabShortcutOptions): boolean {
  const { connectionId, actions, onOpenMenu } = options
  const { tabs, active } = tabsAndActive(connectionId)
  const otherUnpinned = () => tabs.filter((t) => !t.pinned && t.id !== active?.id).map((t) => t.id)
  const activate = (id: string | undefined) => id && actions.activate(id)
  const numbered = numberedTabIndex(e)

  if (matchesBinding(e, 'sql:tabMenu')) onOpenMenu()
  else if (matchesBinding(e, 'sql:nextTab')) activate(neighbourId(tabs, active?.id, 1))
  else if (matchesBinding(e, 'sql:prevTab')) activate(neighbourId(tabs, active?.id, -1))
  else if (matchesBinding(e, 'sql:goToLastTab')) activate(tabs[tabs.length - 1]?.id)
  else if (numbered >= 0) activate(tabs[numbered]?.id)
  else if (matchesBinding(e, 'sql:closeTab')) active && actions.close(active.id)
  else if (matchesBinding(e, 'sql:closeOtherTabs')) actions.closeMany(otherUnpinned())
  else if (matchesBinding(e, 'sql:pinTab')) active && actions.pin(active.id, !active.pinned)
  else if (matchesBinding(e, 'sql:reopenClosedTab')) actions.reopenClosed()
  else return false
  return true
}

export function useTabShortcuts(options: TabShortcutOptions): void {
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!optionsRef.current.enabled || isSearchOpen()) return
      if (!runShortcut(e, optionsRef.current)) return
      e.preventDefault()
      e.stopPropagation()
    }

    const handleCloseRequest = (e: Event) => {
      const { enabled, connectionId, actions } = optionsRef.current
      if (!enabled || isSearchOpen() || getBinding('sql:closeTab') !== MENU_CLOSE_COMBO) return
      e.preventDefault()
      const { active } = tabsAndActive(connectionId)
      if (active) actions.close(active.id)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener(CLOSE_REQUEST_EVENT, handleCloseRequest)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener(CLOSE_REQUEST_EVENT, handleCloseRequest)
    }
  }, [])
}
