import { useEffect, useCallback, useRef } from 'react'
import { getSQLConnectionState, useSQLStore } from '@/stores/sqlStore'
import type { SQLTab } from '@/types/sql'

/**
 * SQL-specific keyboard shortcuts — only active when the SQL sub-tab is
 * the active panel AND the SQL connection is established.
 *
 * Non-conflicting shortcuts (safe in Electron/macOS):
 *   Cmd+Enter          — Run query (dispatches event to QueryEditor)
 *   Cmd+S              — Apply staged changes (overrides save — fine in Electron)
 *   Cmd+Shift+N        — New query tab (was Cmd+T — conflicts with OS)
 *   Cmd+Shift+W        — Close current SQL tab (was Cmd+W — conflicts with OS)
 *   Cmd+Shift+I        — Insert new row
 *   Cmd+.              — Cycle tab type: data → structure → query
 *   Escape             — Cancel cell edit / close overlays
 *
 * NOTE: Removed Cmd+R (conflicts with reload), Cmd+H (hides app on macOS),
 *   Cmd+F (find-in-page), Cmd+E (Spotlight), Cmd+T (new tab), Cmd+W (close window),
 *   Cmd+Z (text undo). These are too disruptive to override.
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
    if (conn.activeTabId) store.removeTab(connectionIdRef.current, conn.activeTabId)
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

  // ── Cycle tab type (data → structure → query) ──
  const cycleTabType = useCallback(() => {
    const conn = getSQLConnectionState(connectionIdRef.current)
    const store = useSQLStore.getState()
    const activeTab = conn.tabs.find((t) => t.id === conn.activeTabId)
    if (!activeTab || !activeTab.table) return

    const cycle: Record<string, string> = {
      data: 'structure',
      structure: 'query',
      query: 'data',
    }
    const nextType = cycle[activeTab.type] as SQLTab['type']

    const existing = conn.tabs.find(
      (t) => t.type === nextType && (nextType === 'query' || t.table === activeTab.table)
    )

    if (existing) {
      store.setActiveTab(connectionIdRef.current, existing.id)
    } else {
      const label =
        nextType === 'query'
          ? `Query ${conn.tabs.filter((t) => t.type === 'query').length + 1}`
          : nextType === 'structure'
            ? `${activeTab.table} (structure)`
            : activeTab.table
      const newTab: SQLTab = {
        id: crypto.randomUUID(),
        type: nextType,
        label,
        table: nextType !== 'query' ? activeTab.table : undefined,
      }
      store.addTab(connectionIdRef.current, newTab)
    }
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Only process when SQL panel is actively visible + connected
      if (!isActiveRef.current || !sqlSessionRef.current) return

      const ctrl = e.ctrlKey || e.metaKey

      // ── Escape: Cancel cell edit / close overlays ──
      if (e.key === 'Escape') {
        window.dispatchEvent(new CustomEvent('sql:escape'))
        return
      }

      if (!ctrl) return

      // ── Cmd+Enter: Run query ──
      // (Monaco also handles this internally, but we dispatch for non-Monaco contexts)
      if (e.key === 'Enter') {
        e.preventDefault()
        window.dispatchEvent(
          new CustomEvent('sql:run-query', {
            detail: { sqlSessionId: sqlSessionRef.current },
          })
        )
        return
      }

      // ── Cmd+S: Apply staged changes ──
      // Safe to override in Electron (no native "Save" meaning for a DB client)
      // Skip only if inside Monaco editor (let it handle its own Cmd+S)
      if (!e.shiftKey && e.key === 's') {
        const target = e.target as HTMLElement
        if (target?.closest('.monaco-editor')) return
        e.preventDefault()
        applyChanges()
        return
      }

      // ── Cmd+Shift+N: New query tab ──
      if (e.shiftKey && e.key === 'N') {
        e.preventDefault()
        addQueryTab()
        return
      }

      // ── Cmd+Shift+W: Close current SQL tab ──
      if (e.shiftKey && e.key === 'W') {
        e.preventDefault()
        closeActiveTab()
        return
      }

      // ── Cmd+Shift+I: Insert new row ──
      if (e.shiftKey && e.key === 'I') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('sql:insert-row'))
        return
      }

      // ── Cmd+.: Cycle tab type ──
      if (e.key === '.') {
        e.preventDefault()
        cycleTabType()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [addQueryTab, closeActiveTab, applyChanges, cycleTabType])
}
