import { useEffect, useCallback, useRef } from 'react'
import { getSQLConnectionState, useSQLStore } from '@/stores/sqlStore'
import { matchesBinding } from '@/stores/keybindingStore'
import type { SQLTab } from '@/types/sql'

/**
 * SQL-specific keyboard shortcuts — only active when the SQL sub-tab is
 * the active panel AND the SQL connection is established.
 *
 * Keybindings are read from the keybinding store (customizable via Settings → Shortcuts).
 *
 * Hardcoded (non-customizable):
 *   Escape  — Cancel cell edit / close overlays
 *
 * NOTE: Copy/paste, Cmd+Z (undo), browser shortcuts are NOT overridden.
 */
export function useSQLShortcuts(
  connectionId: string,
  sqlSessionId: string | null,
  isActive: boolean
) {
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  const sqlSessionRef = useRef(sqlSessionId)
  sqlSessionRef.current = sqlSessionId

  const connectionIdRef = useRef(connectionId)
  connectionIdRef.current = connectionId

  // ── New query tab ──
  const addQueryTab = useCallback(() => {
    const conn = getSQLConnectionState(connectionIdRef.current)
    const store = useSQLStore.getState()
    const queryCount = conn.tabs.filter((t) => t.type === 'query').length + 1
    const newTab: SQLTab = {
      id: crypto.randomUUID(),
      type: 'query',
      label: `Query ${queryCount}`,
    }
    store.addTab(connectionIdRef.current, newTab)
  }, [])

  // ── Close active tab ──
  const closeActiveTab = useCallback(() => {
    const conn = getSQLConnectionState(connectionIdRef.current)
    const store = useSQLStore.getState()
    if (!conn.activeTabId) return
    // Clear selectedTable if closing its tab — allows re-opening via sidebar click
    const closingTab = conn.tabs.find((t) => t.id === conn.activeTabId)
    if (closingTab?.table && closingTab.table === conn.selectedTable) {
      store.setSelectedTable(connectionIdRef.current, null)
    }
    store.removeTab(connectionIdRef.current, conn.activeTabId)
  }, [])

  // ── Apply staged changes ──
  const applyChanges = useCallback(() => {
    if (!sqlSessionRef.current) return
    window.dispatchEvent(
      new CustomEvent('sql:apply-changes', {
        detail: { sqlSessionId: sqlSessionRef.current, connectionId: connectionIdRef.current },
      })
    )
  }, [])

  // ── Toggle view mode (data ↔ structure) within data tabs ──
  const toggleViewMode = useCallback(() => {
    const conn = getSQLConnectionState(connectionIdRef.current)
    const activeTab = conn.tabs.find((t) => t.id === conn.activeTabId)
    if (!activeTab) return

    // Only toggle view mode on data tabs that have a table
    if (activeTab.type === 'data' && activeTab.table) {
      window.dispatchEvent(
        new CustomEvent('sql:toggle-view-mode', {
          detail: { connectionId: connectionIdRef.current, table: activeTab.table },
        })
      )
    }
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Only process when SQL panel is actively visible + connected
      if (!isActiveRef.current || !sqlSessionRef.current) return

      // ── Escape: Cancel cell edit / close overlays (hardcoded — universal) ──
      if (e.key === 'Escape') {
        window.dispatchEvent(new CustomEvent('sql:escape'))
        return
      }

      // ── Refresh data (default F5) ──
      if (matchesBinding(e, 'sql:refresh')) {
        e.preventDefault()
        window.dispatchEvent(
          new CustomEvent('sql:refresh-data', {
            detail: { sqlSessionId: sqlSessionRef.current, connectionId: connectionIdRef.current },
          })
        )
        return
      }

      // ── Toggle sidebar (default CmdOrCtrl+B) ──
      if (matchesBinding(e, 'sql:toggleSidebar')) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('sql:toggle-sidebar'))
        return
      }

      // ── Run query (default CmdOrCtrl+Enter) ──
      if (matchesBinding(e, 'sql:runQuery')) {
        e.preventDefault()
        window.dispatchEvent(
          new CustomEvent('sql:run-query', {
            detail: { sqlSessionId: sqlSessionRef.current },
          })
        )
        return
      }

      // ── Apply staged changes (default CmdOrCtrl+S) ──
      // Skip if inside Monaco editor (let it handle its own save)
      if (matchesBinding(e, 'sql:applyChanges')) {
        const target = e.target as HTMLElement
        if (target?.closest('.monaco-editor')) return
        e.preventDefault()
        applyChanges()
        return
      }

      // ── New query tab (default CmdOrCtrl+Shift+N) ──
      if (matchesBinding(e, 'sql:newTab')) {
        e.preventDefault()
        addQueryTab()
        return
      }

      // ── Close current SQL tab (default CmdOrCtrl+Shift+W) ──
      if (matchesBinding(e, 'sql:closeTab')) {
        e.preventDefault()
        closeActiveTab()
        return
      }

      // ── Insert new row (default CmdOrCtrl+Shift+I) ──
      if (matchesBinding(e, 'sql:insertRow')) {
        e.preventDefault()
        const conn = getSQLConnectionState(connectionIdRef.current)
        const activeTab = conn.tabs.find((t) => t.id === conn.activeTabId)
        window.dispatchEvent(new CustomEvent('sql:insert-row', {
          detail: { connectionId: connectionIdRef.current, table: activeTab?.table },
        }))
        return
      }

      // ── Toggle data/structure view mode (default CmdOrCtrl+.) ──
      if (matchesBinding(e, 'sql:cycleTabType')) {
        e.preventDefault()
        toggleViewMode()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [addQueryTab, closeActiveTab, applyChanges, toggleViewMode])
}
