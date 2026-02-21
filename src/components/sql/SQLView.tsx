import { useState, useCallback, useEffect, useMemo, useRef, lazy, Suspense, memo } from 'react'
import { cn } from '@/utils/cn'
import { Splitter } from '@/components/ui/Splitter'
import { Button } from '@/components/ui/Button'
import { Database, Plug, AlertCircle, Pencil, Loader2, ScrollText } from 'lucide-react'
import { SQLQueryLog } from './SQLQueryLog'
import { useSQLConnection, getSQLConnectionState } from '@/stores/sqlStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { SchemaSidebar } from './SchemaSidebar'
import { SQLConnectDialog } from './SQLConnectDialog'
import { DatabasePickerDialog } from './DatabasePickerDialog'
import { SQLTabBar } from './SQLTabBar'
import { SQLStatusBar } from './SQLStatusBar'
import { useSQLShortcuts } from './useSQLShortcuts'
import type { SQLTab } from '@/types/sql'

// ── Lazy-loaded heavy sub-components ──
const LazyDataTabView = lazy(() => import('./DataTabView'))
const LazyQueryEditor = lazy(() => import('./QueryEditor'))
const LazyStructureTabView = lazy(() => import('./StructureTabView'))
// QueryHistoryPanel is still used by QueryEditor for its own history panel

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

// ── Tag color mapping ──
const TAG_COLORS: Record<string, string> = {
  development: 'bg-blue-500',
  staging: 'bg-yellow-500',
  production: 'bg-red-500',
  testing: 'bg-green-500',
}

// ── Saved config display for disconnected state ──
interface SavedConfig {
  connectionName?: string
  type: string
  host: string
  port: number
  username: string
  database: string
  tag?: string
  sslMode?: string
  useSSHTunnel?: boolean
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
  const [showDatabasePicker, setShowDatabasePicker] = useState(false)
  const [showQueryLog, setShowQueryLog] = useState(false)
  const [dbPickerSessionId, setDbPickerSessionId] = useState<string | null>(null)
  const [savedConfig, setSavedConfig] = useState<SavedConfig | null>(null)
  const [savedConfigLoading, setSavedConfigLoading] = useState(true)
  const [quickConnecting, setQuickConnecting] = useState(false)
  const quickConnectRef = useRef(false) // Synchronous guard against double-click

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
    setConnectionConfig,
    setCurrentDatabase,
    setSqlSessionId,
    setTunnelPort,
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

  // ── Load saved SQL config for disconnected state display ──
  useEffect(() => {
    if (connectionStatus !== 'disconnected') return
    setSavedConfigLoading(true)
    ;(async () => {
      try {
        const result = await (window as any).novadeck.sql.configGet(sessionId)
        if (result?.success && result.data) {
          setSavedConfig({
            connectionName: result.data.connectionName,
            type: result.data.type ?? 'mysql',
            host: result.data.host ?? '127.0.0.1',
            port: result.data.port ?? 3306,
            username: result.data.username ?? 'root',
            database: result.data.database ?? '',
            tag: result.data.tag,
            sslMode: result.data.sslMode,
            useSSHTunnel: result.data.useSSHTunnel,
          })
        } else {
          setSavedConfig(null)
        }
      } catch {
        setSavedConfig(null)
      } finally {
        setSavedConfigLoading(false)
      }
    })()
  }, [sessionId, connectionStatus])

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

  // ── Quick connect from saved config ──
  const handleQuickConnect = useCallback(async () => {
    if (!savedConfig || quickConnectRef.current) return
    quickConnectRef.current = true
    setQuickConnecting(true)
    setConnectionStatus('connecting')

    const sqlSessId = `sql-${connectionId}-${crypto.randomUUID()}`

    try {
      const result = await (window as any).novadeck.sql.configGet(sessionId)
      if (!result?.success || !result.data) {
        throw new Error('Saved configuration not found')
      }

      const c = result.data
      const config = {
        type: c.type ?? 'mysql',
        host: c.host ?? '127.0.0.1',
        port: c.port ?? 3306,
        username: c.username ?? 'root',
        password: c.password ?? '',
        database: c.database?.trim() || undefined,
        useSSHTunnel: c.useSSHTunnel ?? true,
        ssl: c.sslMode ? c.sslMode !== 'disabled' : c.ssl ?? false,
        sslMode: c.sslMode,
      }

      const connectResult = await window.novadeck.sql.connect(
        sqlSessId,
        connectionId,
        config
      )

      if (connectResult.success) {
        const resolvedDb = (c.database?.trim()) || connectResult.currentDatabase || ''

        setConnectionStatus('connected')
        setConnectionConfig({
          id: sqlSessId,
          name: c.connectionName || `${config.type}://${config.host}:${config.port}/${resolvedDb || 'server'}`,
          type: config.type,
          host: config.host,
          port: config.port,
          username: config.username,
          password: config.password,
          database: resolvedDb,
          useSSHTunnel: config.useSSHTunnel,
          ssl: config.ssl,
          sslMode: config.sslMode,
          isProduction: c.tag === 'production' || c.isProduction,
          tag: c.tag,
          connectionName: c.connectionName,
        })
        setCurrentDatabase(resolvedDb)
        setSqlSessionId(sqlSessId)
        setTunnelPort(connectResult.tunnelPort ?? null)
        setConnectionError(null)

        // If no database was specified, show picker
        if (!c.database?.trim()) {
          setDbPickerSessionId(sqlSessId)
          setShowDatabasePicker(true)
        }
      } else {
        setConnectionStatus('error')
        setConnectionError(connectResult.error || 'Connection failed')
      }
    } catch (err: any) {
      setConnectionStatus('error')
      setConnectionError(err.message || String(err))
    } finally {
      setQuickConnecting(false)
      quickConnectRef.current = false
    }
  }, [
    savedConfig, connectionId, sessionId, setConnectionStatus, setConnectionConfig,
    setCurrentDatabase, setSqlSessionId, setTunnelPort, setConnectionError
  ])

  // ── Handle database selection from picker ──
  const handleDatabaseSelected = useCallback(async (database: string) => {
    const sid = dbPickerSessionId || sqlSessionId
    if (!sid) return

    try {
      const result = await window.novadeck.sql.switchDatabase(sid, database)
      if (result.success) {
        setCurrentDatabase(database)
      } else {
        // Postgres doesn't support switchDatabase — reconnect with the selected DB
        const config = connectionConfig
        if (config) {
          // Disconnect old session
          await window.novadeck.sql.disconnect(sid).catch(() => {})
          // Reconnect with selected database
          const newSid = `sql-${connectionId}-${crypto.randomUUID()}`
          const reconnResult = await window.novadeck.sql.connect(newSid, connectionId, {
            type: config.type,
            host: config.host,
            port: config.port,
            username: config.username,
            password: config.password,
            database,
            useSSHTunnel: config.useSSHTunnel,
            ssl: config.ssl,
            sslMode: (config as any).sslMode,
          })
          if (reconnResult.success) {
            setSqlSessionId(newSid)
            setCurrentDatabase(database)
            setTunnelPort(reconnResult.tunnelPort ?? null)
            // Update connectionConfig with new database
            setConnectionConfig({ ...config, id: newSid, database })
          }
        }
      }
    } catch {
      // switchDatabase threw (Postgres) — try reconnect approach
      const config = connectionConfig
      if (config) {
        try {
          await window.novadeck.sql.disconnect(sid).catch(() => {})
          const newSid = `sql-${connectionId}-${crypto.randomUUID()}`
          const reconnResult = await window.novadeck.sql.connect(newSid, connectionId, {
            type: config.type,
            host: config.host,
            port: config.port,
            username: config.username,
            password: config.password,
            database,
            useSSHTunnel: config.useSSHTunnel,
            ssl: config.ssl,
            sslMode: (config as any).sslMode,
          })
          if (reconnResult.success) {
            setSqlSessionId(newSid)
            setCurrentDatabase(database)
            setTunnelPort(reconnResult.tunnelPort ?? null)
            setConnectionConfig({ ...config, id: newSid, database })
          }
        } catch {
          // Reconnect also failed — leave state as-is
        }
      }
    }
    setShowDatabasePicker(false)
    setDbPickerSessionId(null)
  }, [dbPickerSessionId, sqlSessionId, connectionId, connectionConfig, setCurrentDatabase, setSqlSessionId, setTunnelPort, setConnectionConfig])

  // ── Handle onNeedDatabasePick from connect dialog ──
  const handleNeedDatabasePick = useCallback((sid: string) => {
    setDbPickerSessionId(sid)
    setShowDatabasePicker(true)
  }, [])

  // ── Tab actions ──
  const handleTabSelect = useCallback(
    (id: string) => {
      setActiveTab(id)
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

  // ── Save / Discard dispatchers (status bar → DataTabView via events) ──
  const handleStatusBarSave = useCallback(() => {
    if (!sqlSessionId) return
    window.dispatchEvent(
      new CustomEvent('sql:apply-changes', {
        detail: { sqlSessionId, connectionId },
      })
    )
  }, [sqlSessionId, connectionId])

  const handleStatusBarDiscard = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('sql:discard-changes', { detail: { connectionId } })
    )
  }, [connectionId])

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
        {savedConfigLoading ? (
          <div className="animate-spin w-5 h-5 rounded-full border-2 border-nd-accent border-t-transparent" />
        ) : savedConfig ? (
          /* ── Saved connection card ── */
          <div className="flex flex-col items-center gap-4 w-full max-w-sm">
            <div className="w-full rounded-lg border border-nd-border bg-nd-bg-secondary p-4 space-y-3">
              {/* Header */}
              <div className="flex items-center gap-2">
                <Database size={18} className="text-nd-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-nd-text-primary truncate">
                    {savedConfig.connectionName || `${savedConfig.type.toUpperCase()} Connection`}
                  </p>
                  {savedConfig.tag && savedConfig.tag !== 'none' && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={cn('w-2 h-2 rounded-full', TAG_COLORS[savedConfig.tag] || '')} />
                      <span className="text-2xs text-nd-text-muted capitalize">{savedConfig.tag}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Details */}
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-nd-text-muted w-16 shrink-0">Type</span>
                  <span className="text-nd-text-secondary font-mono">{savedConfig.type.toUpperCase()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-nd-text-muted w-16 shrink-0">Host</span>
                  <span className="text-nd-text-secondary font-mono truncate">
                    {savedConfig.host}:{savedConfig.port}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-nd-text-muted w-16 shrink-0">User</span>
                  <span className="text-nd-text-secondary font-mono">{savedConfig.username}</span>
                </div>
                {savedConfig.database && (
                  <div className="flex items-center gap-2">
                    <span className="text-nd-text-muted w-16 shrink-0">Database</span>
                    <span className="text-nd-text-secondary font-mono truncate">{savedConfig.database}</span>
                  </div>
                )}
                {savedConfig.useSSHTunnel && (
                  <div className="flex items-center gap-2">
                    <span className="text-nd-text-muted w-16 shrink-0">Tunnel</span>
                    <span className="text-nd-text-secondary">SSH Tunnel</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleQuickConnect}
                  disabled={quickConnecting}
                >
                  {quickConnecting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Plug size={14} />
                  )}
                  Connect
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleOpenConnect}
                  title="Edit connection settings"
                >
                  <Pencil size={14} />
                  Edit
                </Button>
              </div>
            </div>

            {/* New connection link */}
            <button
              onClick={handleOpenConnect}
              className="text-xs text-nd-text-muted hover:text-nd-accent transition-colors"
            >
              Or create a new connection
            </button>
          </div>
        ) : (
          /* ── No saved config — default state ── */
          <>
            <div className="flex flex-col items-center gap-2">
              <Database size={32} className="text-nd-text-muted" />
              <p className="text-sm text-nd-text-muted">Connect to a database to get started</p>
            </div>
            <Button variant="primary" onClick={handleOpenConnect}>
              <Plug size={14} />
              Connect to Database
            </Button>
          </>
        )}

        <SQLConnectDialog
          open={showConnectDialog}
          onClose={handleCloseConnect}
          connectionId={connectionId}
          sessionId={sessionId}
          onNeedDatabasePick={handleNeedDatabasePick}
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
          {currentDatabase || '(no database)'}
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

      {/* Query Log bottom panel */}
      {showQueryLog && (
        <div
          className="shrink-0 border-t border-nd-border bg-nd-bg-secondary overflow-hidden"
          style={{ height: 160 }}
        >
          <SQLQueryLog connectionId={connectionId} />
        </div>
      )}

      {/* Status Bar */}
      <div className="flex items-center shrink-0">
        <div className="flex-1">
          <SQLStatusBar {...statusBarProps} onSave={handleStatusBarSave} onDiscard={handleStatusBarDiscard} />
        </div>
        <button
          onClick={() => setShowQueryLog((v) => !v)}
          className={cn(
            'flex items-center gap-1 px-2 h-7 text-2xs font-medium border-t border-l transition-colors',
            showQueryLog
              ? 'text-nd-accent border-nd-border bg-nd-bg-secondary'
              : 'text-nd-text-muted border-nd-border bg-nd-bg-secondary hover:text-nd-text-secondary'
          )}
          title="Toggle query log"
        >
          <ScrollText size={11} />
          Log
        </button>
      </div>

      {/* Connect dialog (for reconnect / edit) */}
      <SQLConnectDialog
        open={showConnectDialog}
        onClose={handleCloseConnect}
        connectionId={connectionId}
        sessionId={sessionId}
        onNeedDatabasePick={handleNeedDatabasePick}
      />

      {/* Database picker dialog */}
      {showDatabasePicker && (dbPickerSessionId || sqlSessionId) && (
        <DatabasePickerDialog
          open={showDatabasePicker}
          onClose={() => { setShowDatabasePicker(false); setDbPickerSessionId(null) }}
          sqlSessionId={(dbPickerSessionId || sqlSessionId)!}
          onSelect={handleDatabaseSelected}
        />
      )}
    </div>
  )
})

export default SQLView
export { SQLView }
