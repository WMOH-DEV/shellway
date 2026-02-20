import { useState, useCallback, useEffect, useMemo, lazy, Suspense, memo } from 'react'
import { cn } from '@/utils/cn'
import { Splitter } from '@/components/ui/Splitter'
import { Button } from '@/components/ui/Button'
import { Database, Plug, AlertCircle } from 'lucide-react'
import { useSQLConnection, getSQLConnectionState } from '@/stores/sqlStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { SchemaSidebar } from './SchemaSidebar'
import { SQLConnectDialog } from './SQLConnectDialog'
import { SQLTabBar } from './SQLTabBar'
import { SQLStatusBar } from './SQLStatusBar'
import { useSQLShortcuts } from './useSQLShortcuts'
import type { SQLTab } from '@/types/sql'

// ── Lazy-loaded heavy sub-components ──
const LazyDataTabView = lazy(() => import('./DataTabView'))
const LazyQueryEditor = lazy(() => import('./QueryEditor'))
const LazyStructureTabView = lazy(() => import('./StructureTabView'))

// ── Loading fallback ──
function PanelSpinner() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin w-4 h-4 rounded-full border-2 border-nd-accent border-t-transparent" />
    </div>
  )
}

// ── Empty state when no tab is active ──
function EmptyPanel() {
  return (
    <div className="flex items-center justify-center h-full text-sm text-nd-text-muted">
      Select a table or open a query tab
    </div>
  )
}

interface SQLViewProps {
  connectionId: string
  sessionId: string
}

// ── Sidebar percentage for splitter (240px / typical width ~1200px) ──
const SIDEBAR_SPLIT_PERCENT = 20

/**
 * Main SQL panel component — manages connection lifecycle, tab routing, and layout.
 */
const SQLView = memo(function SQLView({ connectionId, sessionId }: SQLViewProps) {
  const [showConnectDialog, setShowConnectDialog] = useState(false)

  // ── Store selectors (scoped to this connection) ──
  const {
    connectionStatus,
    currentDatabase,
    connectionError,
    sqlSessionId,
    connectionConfig,
    selectedTable,
    tabs,
    activeTabId,
    stagedChanges,
    filters,
    reset,
    setConnectionStatus,
    setConnectionError,
    addTab,
    removeTab,
    setActiveTab,
    setSelectedTable,
  } = useSQLConnection(connectionId)

  // ── Check if SQL sub-tab is actually the active one (not hidden behind Terminal/SFTP) ──
  const isSQLSubTabActive = useConnectionStore(
    useCallback((s) => {
      const tab = s.tabs.find((t) => t.id === connectionId)
      return tab?.activeSubTab === 'sql'
    }, [connectionId])
  )

  // ── SQL keyboard shortcuts (only active when SQL sub-tab is visible + connected) ──
  useSQLShortcuts(connectionId, sqlSessionId, connectionStatus === 'connected' && isSQLSubTabActive)

  // ── Derived: active tab ──
  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId]
  )

  // ── Cleanup on unmount — disconnect SQL session ──
  useEffect(() => {
    return () => {
      const sid = getSQLConnectionState(connectionId).sqlSessionId
      if (sid) {
        window.novadeck.sql.disconnect(sid).catch(() => {})
      }
      reset()
    }
  }, [connectionId, reset])

  // ── When selectedTable changes in sidebar, open/focus a data tab for it ──
  useEffect(() => {
    if (!selectedTable || !sqlSessionId) return

    // Check if a data tab for this table already exists
    const existingTab = tabs.find(
      (t) => t.type === 'data' && t.table === selectedTable
    )
    if (existingTab) {
      setActiveTab(existingTab.id)
    } else {
      // Create a new data tab
      const newTab: SQLTab = {
        id: crypto.randomUUID(),
        type: 'data',
        label: selectedTable,
        table: selectedTable,
      }
      addTab(newTab)
    }
  }, [selectedTable]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dialog handlers ──
  const handleOpenConnect = useCallback(() => setShowConnectDialog(true), [])
  const handleCloseConnect = useCallback(() => setShowConnectDialog(false), [])

  const handleDisconnect = useCallback(async () => {
    if (sqlSessionId) {
      try {
        await window.novadeck.sql.disconnect(sqlSessionId)
      } catch {
        // Ignore disconnect errors
      }
    }
    reset()
  }, [sqlSessionId, reset])

  const handleRetry = useCallback(() => {
    setConnectionStatus('disconnected')
    setConnectionError(null)
    setShowConnectDialog(true)
  }, [setConnectionStatus, setConnectionError])

  // ── Tab actions ──
  const handleTabSelect = useCallback(
    (id: string) => {
      setActiveTab(id)
      // Also sync selectedTable when switching to a data/structure tab
      const tab = getSQLConnectionState(connectionId).tabs.find((t) => t.id === id)
      if (tab?.table) {
        setSelectedTable(tab.table)
      }
    },
    [connectionId, setActiveTab, setSelectedTable]
  )

  const handleTabClose = useCallback(
    (id: string) => removeTab(id),
    [removeTab]
  )

  const handleNewQuery = useCallback(() => {
    const queryCount = tabs.filter((t) => t.type === 'query').length + 1
    const newTab: SQLTab = {
      id: crypto.randomUUID(),
      type: 'query',
      label: `Query ${queryCount}`,
    }
    addTab(newTab)
  }, [tabs, addTab])

  const handleOpenStructure = useCallback(
    (tableName: string) => {
      // Check if a structure tab for this table already exists
      const existingTab = tabs.find(
        (t) => t.type === 'structure' && t.table === tableName
      )
      if (existingTab) {
        setActiveTab(existingTab.id)
      } else {
        const newTab: SQLTab = {
          id: crypto.randomUUID(),
          type: 'structure',
          label: `${tableName} (structure)`,
          table: tableName,
        }
        addTab(newTab)
      }
    },
    [tabs, addTab, setActiveTab]
  )

  // ── Tab content renderer ──
  const renderTabContent = useCallback(() => {
    if (!activeTab || !sqlSessionId || !connectionConfig) return <EmptyPanel />

    const dbType = connectionConfig.type

    switch (activeTab.type) {
      case 'data':
        return activeTab.table ? (
          <LazyDataTabView
            connectionId={connectionId}
            sqlSessionId={sqlSessionId}
            table={activeTab.table}
            schema={activeTab.schema}
            dbType={dbType}
          />
        ) : (
          <EmptyPanel />
        )

      case 'query':
        return (
          <LazyQueryEditor
            connectionId={connectionId}
            sqlSessionId={sqlSessionId}
            dbType={dbType}
          />
        )

      case 'structure':
        return activeTab.table ? (
          <LazyStructureTabView
            sqlSessionId={sqlSessionId}
            table={activeTab.table}
            schema={activeTab.schema}
          />
        ) : (
          <EmptyPanel />
        )

      default:
        return <EmptyPanel />
    }
  }, [activeTab, sqlSessionId, connectionConfig, connectionId])

  // ── Status bar props ──
  const statusBarProps = useMemo(() => {
    return {
      dbType: connectionConfig?.type?.toUpperCase(),
      database: currentDatabase || undefined,
      table: activeTab?.table,
      filterCount: filters.length,
      changeCount: stagedChanges.length,
    }
  }, [connectionConfig, currentDatabase, activeTab, filters, stagedChanges])

  // ── Disconnected state ──
  if (connectionStatus === 'disconnected') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="flex flex-col items-center gap-2">
          <Database size={32} className="text-nd-text-muted" />
          <p className="text-sm text-nd-text-muted">Connect to a database to get started</p>
        </div>
        <Button variant="primary" onClick={handleOpenConnect}>
          <Plug size={14} />
          Connect to Database
        </Button>

        <SQLConnectDialog
          open={showConnectDialog}
          onClose={handleCloseConnect}
          connectionId={connectionId}
        />
      </div>
    )
  }

  // ── Connecting state ──
  if (connectionStatus === 'connecting') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="animate-spin w-6 h-6 rounded-full border-2 border-nd-accent border-t-transparent" />
        <p className="text-sm text-nd-text-muted">Connecting to database...</p>
      </div>
    )
  }

  // ── Error state ──
  if (connectionStatus === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="flex flex-col items-center gap-2">
          <AlertCircle size={32} className="text-nd-error" />
          <p className="text-sm text-nd-text-primary">Connection failed</p>
          {connectionError && (
            <p className="text-xs text-nd-text-muted max-w-sm text-center">{connectionError}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={handleDisconnect}>
            Dismiss
          </Button>
          <Button variant="primary" onClick={handleRetry}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  // ── Connected state ──
  return (
    <div className="flex flex-col h-full">
      {/* Connection toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-nd-border bg-nd-bg-secondary shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
          <span className="text-xs text-nd-text-secondary">
            {connectionConfig?.type?.toUpperCase()}
          </span>
        </div>
        <span className="text-xs text-nd-text-muted">/</span>
        <span className="text-xs font-medium text-nd-text-primary truncate">
          {currentDatabase}
        </span>

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="icon"
          onClick={handleDisconnect}
          title="Disconnect"
          className="!h-6 !w-6"
        >
          <Plug size={12} className="text-nd-text-muted" />
        </Button>
      </div>

      {/* Main content: sidebar + (tab bar + content) */}
      <div className="flex-1 overflow-hidden">
        <Splitter
          left={<SchemaSidebar connectionId={connectionId} />}
          right={
            <div className="flex flex-col h-full">
              {/* SQL Tab Bar */}
              <SQLTabBar
                tabs={tabs}
                activeTabId={activeTabId}
                onSelect={handleTabSelect}
                onClose={handleTabClose}
                onNewQuery={handleNewQuery}
              />

              {/* Tab content area */}
              <div className="flex-1 overflow-hidden">
                <Suspense fallback={<PanelSpinner />}>
                  {renderTabContent()}
                </Suspense>
              </div>
            </div>
          }
          direction="horizontal"
          defaultSplit={SIDEBAR_SPLIT_PERCENT}
          minSize={180}
          className="h-full"
        />
      </div>

      {/* Status Bar */}
      <SQLStatusBar {...statusBarProps} />

      {/* Connect dialog (for reconnect) */}
      <SQLConnectDialog
        open={showConnectDialog}
        onClose={handleCloseConnect}
        connectionId={connectionId}
      />
    </div>
  )
})

export default SQLView
export { SQLView }
