import { useState, useCallback, useEffect, useMemo, useRef, lazy, Suspense, memo } from 'react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import {
  Database,
  Plug,
  Unplug,
  AlertCircle,
  Pencil,
  Loader2,
  ScrollText,
  RefreshCw,
  Plus,
  PanelLeft,
  PanelBottom,
  Download,
  Upload,
  HardDrive,
} from 'lucide-react'
import { SQLQueryLog } from './SQLQueryLog'
import { useSQLConnection, getSQLConnectionState } from '@/stores/sqlStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { SchemaSidebar, type TableContextAction, type DatabaseContextAction } from './SchemaSidebar'
import { SQLConnectDialog } from './SQLConnectDialog'
import { DatabasePickerDialog } from './DatabasePickerDialog'
import { CreateDatabaseDialog } from './CreateDatabaseDialog'
import { ExportTableDialog } from './ExportTableDialog'
import { ImportSQLDialog } from './ImportSQLDialog'
import { ImportCSVDialog } from './ImportCSVDialog'
import { BackupRestoreDialog } from './BackupRestoreDialog'
import { SQLTabBar } from './SQLTabBar'
import { SQLStatusBar } from './SQLStatusBar'
import { useSQLShortcuts } from './useSQLShortcuts'
import type { SQLTab, SchemaColumn } from '@/types/sql'

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
  sshHost?: string
  sshUsername?: string
}

interface SQLViewProps {
  connectionId: string
  sessionId: string
  /** When true, this is a standalone database view (not nested inside an SSH ConnectionView) */
  isStandalone?: boolean
}

/**
 * Main SQL panel component — manages connection lifecycle, tab routing, and layout.
 */
const SQLView = memo(function SQLView({ connectionId, sessionId, isStandalone }: SQLViewProps) {
  const [showConnectDialog, setShowConnectDialog] = useState(false)
  const [showDatabasePicker, setShowDatabasePicker] = useState(false)
  const [showQueryLog, setShowQueryLog] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [dbPickerSessionId, setDbPickerSessionId] = useState<string | null>(null)
  const [savedConfig, setSavedConfig] = useState<SavedConfig | null>(null)
  const [savedConfigLoading, setSavedConfigLoading] = useState(true)
  const [quickConnecting, setQuickConnecting] = useState(false)
  const quickConnectRef = useRef(false) // Synchronous guard against double-click

  // ── Data transfer dialog states ──
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exportDialogTable, setExportDialogTable] = useState<string | null>(null)
  const [showImportSQLDialog, setShowImportSQLDialog] = useState(false)
  const [showImportCSVDialog, setShowImportCSVDialog] = useState(false)
  const [importCSVTable, setImportCSVTable] = useState<string | null>(null)
  const [showCreateDatabaseDialog, setShowCreateDatabaseDialog] = useState(false)
  const [showBackupRestoreDialog, setShowBackupRestoreDialog] = useState(false)
  const [backupRestoreInitialTab, setBackupRestoreInitialTab] = useState<'backup' | 'restore'>('backup')

  // ── Store selectors (scoped to this connection) ──
  const {
    connectionStatus,
    currentDatabase,
    connectionError,
    sqlSessionId,
    connectionConfig,
    selectedTable,
    tables,
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
  // In standalone mode, SQL is always the active view — no sub-tab switching.
  const isSQLSubTabActive = useConnectionStore(
    useCallback((s) => {
      if (isStandalone) return true
      const tab = s.tabs.find((t) => t.id === connectionId)
      return tab?.activeSubTab === 'sql'
    }, [connectionId, isStandalone])
  )

  // ── Sync SQL connection status to the connection tab (for standalone mode) ──
  useEffect(() => {
    if (!isStandalone) return
    const statusMap: Record<string, string> = {
      connected: 'connected',
      connecting: 'connecting',
      disconnected: 'disconnected',
      error: 'error',
    }
    const tabStatus = statusMap[connectionStatus]
    if (tabStatus) {
      useConnectionStore.getState().updateTab(connectionId, { status: tabStatus as any })
    }
  }, [isStandalone, connectionId, connectionStatus])

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
        const result = await window.novadeck.sql.configGet(sessionId)
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
            sshHost: result.data.sshHost,
            sshUsername: result.data.sshUsername,
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

  // ── Listen for sidebar toggle from keyboard shortcut ──
  useEffect(() => {
    const handler = () => setShowSidebar((v) => !v)
    window.addEventListener('sql:toggle-sidebar', handler)
    return () => window.removeEventListener('sql:toggle-sidebar', handler)
  }, [])

  // ── FK navigation — open referenced table with a filter ──
  useEffect(() => {
    const handleNavigateFK = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.connectionId !== connectionId) return

      const { table: refTable, filterColumn, filterValue } = detail

      // Open or focus the data tab for the referenced table
      const existingTab = tabs.find((t) => t.type === 'data' && t.table === refTable)
      let tabId: string
      if (existingTab) {
        tabId = existingTab.id
        setActiveTab(tabId)
      } else {
        tabId = crypto.randomUUID()
        const newTab: SQLTab = {
          id: tabId,
          type: 'data',
          label: refTable,
          table: refTable,
        }
        addTab(newTab)
      }
      setSelectedTable(refTable)

      // Dispatch filter event after a tick so the DataTabView has mounted
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('sql:set-filter', {
            detail: { connectionId, table: refTable, column: filterColumn, value: String(filterValue) },
          })
        )
      }, 100)
    }

    window.addEventListener('sql:navigate-fk', handleNavigateFK)
    return () => window.removeEventListener('sql:navigate-fk', handleNavigateFK)
  }, [connectionId, tabs, setActiveTab, addTab, setSelectedTable])

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
      const config: any = {
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

      // Attach SSH config for standalone tunnels (saved from previous connection)
      if (isStandalone && c.useSSHTunnel && c.sshHost) {
        config.sshConfig = {
          host: c.sshHost,
          port: c.sshPort || 22,
          username: c.sshUsername || '',
          authMethod: c.sshAuthMethod || 'password',
          password: c.sshAuthMethod === 'password' ? c.sshPassword : undefined,
          privateKeyPath: c.sshAuthMethod === 'privatekey' ? c.sshPrivateKeyPath : undefined,
          passphrase: c.sshAuthMethod === 'privatekey' ? c.sshPassphrase : undefined,
        }
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

        // Update tab name for standalone database tabs
        if (isStandalone) {
          const tabName = c.connectionName || `${config.type.toUpperCase()} · ${resolvedDb || config.host}`
          useConnectionStore.getState().updateTab(connectionId, { sessionName: tabName })
        }

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
    savedConfig, connectionId, sessionId, isStandalone, setConnectionStatus, setConnectionConfig,
    setCurrentDatabase, setSqlSessionId, setTunnelPort, setConnectionError
  ])

  // ── Build reconnect config, preserving SSH tunnel settings for standalone tabs ──
  const buildReconnectConfig = useCallback(async (config: typeof connectionConfig, database: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reconnectCfg: Record<string, any> = {
      type: config!.type,
      host: config!.host,
      port: config!.port,
      username: config!.username,
      password: config!.password,
      database,
      useSSHTunnel: config!.useSSHTunnel,
      ssl: config!.ssl,
      sslMode: (config as any)?.sslMode,
    }

    // For standalone DB tabs with SSH tunnels, restore sshConfig from saved config
    if (isStandalone && config!.useSSHTunnel) {
      try {
        const saved = await window.novadeck.sql.configGet(sessionId)
        if (saved?.success && saved.data?.sshHost) {
          const c = saved.data
          reconnectCfg.sshConfig = {
            host: c.sshHost,
            port: c.sshPort || 22,
            username: c.sshUsername || '',
            authMethod: c.sshAuthMethod || 'password',
            password: c.sshAuthMethod === 'password' ? c.sshPassword : undefined,
            privateKeyPath: c.sshAuthMethod === 'privatekey' ? c.sshPrivateKeyPath : undefined,
            passphrase: c.sshAuthMethod === 'privatekey' ? c.sshPassphrase : undefined,
          }
        }
      } catch {
        // Config fetch failed — proceed without SSH (will likely fail, but let the backend report it)
      }
    }

    return reconnectCfg
  }, [isStandalone, sessionId])

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
          await window.novadeck.sql.disconnect(sid).catch(() => {})
          const newSid = `sql-${connectionId}-${crypto.randomUUID()}`
          const reconnectCfg = await buildReconnectConfig(config, database)
          const reconnResult = await window.novadeck.sql.connect(newSid, connectionId, reconnectCfg)
          if (reconnResult.success) {
            setSqlSessionId(newSid)
            setCurrentDatabase(database)
            setTunnelPort(reconnResult.tunnelPort ?? null)
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
          const reconnectCfg = await buildReconnectConfig(config, database)
          const reconnResult = await window.novadeck.sql.connect(newSid, connectionId, reconnectCfg)
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
  }, [dbPickerSessionId, sqlSessionId, connectionId, connectionConfig, buildReconnectConfig, setCurrentDatabase, setSqlSessionId, setTunnelPort, setConnectionConfig])

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
      // Find existing data tab for this table, or create one
      const existingDataTab = tabs.find(
        (t) => t.type === 'data' && t.table === tableName
      )
      if (existingDataTab) {
        setActiveTab(existingDataTab.id)
      } else {
        const newTab: SQLTab = {
          id: crypto.randomUUID(),
          type: 'data',
          label: tableName,
          table: tableName,
        }
        addTab(newTab)
        setSelectedTable(tableName)
      }

      // Dispatch event to switch the data tab's view mode to structure
      // Use a short delay so the DataTabView has time to mount if it was just created
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('sql:switch-to-structure', {
            detail: { connectionId, table: tableName },
          })
        )
      }, 50)
    },
    [tabs, addTab, setActiveTab, setSelectedTable, connectionId]
  )

  // ── SchemaSidebar context menu handlers ──

  const handleTableAction = useCallback(
    (action: TableContextAction) => {
      switch (action.type) {
        case 'export':
          setExportDialogTable(action.table)
          setShowExportDialog(true)
          break
        case 'import-csv':
          setImportCSVTable(action.table)
          setShowImportCSVDialog(true)
          break
        case 'copy-name':
          // Already handled in SchemaSidebar (clipboard copy)
          break
        case 'view-structure':
          handleOpenStructure(action.table)
          break
        case 'drop-table':
          // TODO: Implement drop table confirmation dialog
          break
      }
    },
    [handleOpenStructure]
  )

  const handleDatabaseAction = useCallback(
    (action: DatabaseContextAction) => {
      switch (action.type) {
        case 'export-database':
          setExportDialogTable(null) // null = all tables
          setShowExportDialog(true)
          break
        case 'import-sql':
          setShowImportSQLDialog(true)
          break
        case 'backup':
          setBackupRestoreInitialTab('backup')
          setShowBackupRestoreDialog(true)
          break
        case 'restore':
          setBackupRestoreInitialTab('restore')
          setShowBackupRestoreDialog(true)
          break
        case 'create-database':
          setShowCreateDatabaseDialog(true)
          break
      }
    },
    []
  )

  /** Fetch columns for a table — used by ImportCSVDialog for column mapping */
  const fetchColumnsForTable = useCallback(
    async (table: string): Promise<SchemaColumn[]> => {
      if (!sqlSessionId) return []
      try {
        const result = await (window as any).novadeck.sql.getColumns(
          sqlSessionId,
          table,
          connectionConfig?.type === 'postgres' ? 'public' : undefined
        )
        if (result.success && result.data) {
          return result.data as SchemaColumn[]
        }
      } catch {
        // Silently fail
      }
      return []
    },
    [sqlSessionId, connectionConfig]
  )

  /** Whether an SSH connection is available for backup/restore */
  const hasSSHConnection = useMemo(() => {
    return connectionConfig?.useSSHTunnel === true
  }, [connectionConfig])

  // ── Tab content renderer ──
  // Track which tabs have been visited — mount on first visit, keep alive after
  const [mountedTabIds, setMountedTabIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!activeTabId) return
    setMountedTabIds((prev) => {
      if (prev.has(activeTabId)) return prev
      return new Set([...prev, activeTabId])
    })
  }, [activeTabId])

  // Clean up mounted tab IDs when tabs are removed
  useEffect(() => {
    const tabIds = new Set(tabs.map((t) => t.id))
    setMountedTabIds((prev) => {
      const next = new Set([...prev].filter((id) => tabIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [tabs])

  // ── Save / Discard dispatchers (status bar → DataTabView via events) ──
  // ── Refresh data in the active data tab ──
  const handleRefreshData = useCallback(() => {
    if (!sqlSessionId) return
    window.dispatchEvent(
      new CustomEvent('sql:refresh-data', {
        detail: { sqlSessionId, connectionId },
      })
    )
  }, [sqlSessionId, connectionId])

  // ── Open database picker ──
  const handleSwitchDatabase = useCallback(() => {
    if (!sqlSessionId) return
    setDbPickerSessionId(sqlSessionId)
    setShowDatabasePicker(true)
  }, [sqlSessionId])

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
                    <span className="text-nd-text-secondary font-mono truncate">
                      {savedConfig.sshHost
                        ? `${savedConfig.sshUsername || 'root'}@${savedConfig.sshHost}`
                        : 'SSH Tunnel'}
                    </span>
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
          isStandalone={isStandalone}
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
  const mainContent = (
    <div className="flex flex-col h-full">
      {/* SQL Tab Bar */}
      <SQLTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={handleTabSelect}
        onClose={handleTabClose}
        onNewQuery={handleNewQuery}
      />

      {/* Tab content area — keep all visited tabs mounted, hide inactive via CSS */}
      <div className="flex-1 overflow-hidden relative">
        {(!sqlSessionId || !connectionConfig) ? (
          <EmptyPanel />
        ) : (
          tabs.map((tab) => {
            if (!mountedTabIds.has(tab.id)) return null
            const isActive = tab.id === activeTabId
            const dbType = connectionConfig.type

            return (
              <div
                key={tab.id}
                className={cn('h-full', !isActive && 'hidden')}
              >
                <Suspense fallback={<PanelSpinner />}>
                  {tab.type === 'data' && tab.table ? (
                    <LazyDataTabView
                      connectionId={connectionId}
                      sqlSessionId={sqlSessionId}
                      table={tab.table}
                      schema={tab.schema}
                      dbType={dbType}
                    />
                  ) : tab.type === 'query' ? (
                    <LazyQueryEditor
                      connectionId={connectionId}
                      sqlSessionId={sqlSessionId}
                      dbType={dbType}
                    />
                  ) : tab.type === 'structure' && tab.table ? (
                    <LazyStructureTabView
                      sqlSessionId={sqlSessionId}
                      table={tab.table}
                      schema={tab.schema}
                      dbType={dbType}
                      connectionId={connectionId}
                    />
                  ) : (
                    <EmptyPanel />
                  )}
                </Suspense>
              </div>
            )
          })
        )}
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      {/* ── Connection toolbar ── */}
      <div className="flex items-center gap-0 px-1 h-8 border-b border-nd-border bg-nd-bg-secondary shrink-0">
        {/* Left group: sidebar toggle + connection info */}
        <ToolbarButton
          icon={<PanelLeft size={14} />}
          title={showSidebar ? 'Hide sidebar (Ctrl+B)' : 'Show sidebar (Ctrl+B)'}
          active={showSidebar}
          onClick={() => setShowSidebar((v) => !v)}
        />
        <ToolbarSep />
        <div className="flex items-center gap-1.5 px-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
          <span className="text-xs text-nd-text-secondary">
            {connectionConfig?.type?.toUpperCase()}
          </span>
          <span className="text-xs text-nd-text-muted">/</span>
          <button
            onClick={handleSwitchDatabase}
            className="text-xs font-medium text-nd-text-primary truncate hover:text-nd-accent transition-colors"
            title="Switch database"
          >
            {currentDatabase || '(no database)'}
          </button>
        </div>

        <div className="flex-1" />

        {/* Right group: actions */}
        <ToolbarButton
          icon={<RefreshCw size={13} />}
          title="Refresh data (F5)"
          onClick={handleRefreshData}
        />
        <ToolbarButton
          icon={<Plus size={14} />}
          title="New query tab (Ctrl+Shift+N)"
          onClick={handleNewQuery}
        />
        <ToolbarButton
          icon={<Database size={13} />}
          title="Switch database"
          onClick={handleSwitchDatabase}
        />
        <ToolbarSep />
        <ToolbarButton
          icon={<Download size={13} />}
          title="Export database"
          onClick={() => {
            setExportDialogTable(null)
            setShowExportDialog(true)
          }}
        />
        <ToolbarButton
          icon={<Upload size={13} />}
          title="Import SQL dump"
          onClick={() => setShowImportSQLDialog(true)}
        />
        <ToolbarButton
          icon={<HardDrive size={13} />}
          title="Backup / Restore"
          onClick={() => {
            setBackupRestoreInitialTab('backup')
            setShowBackupRestoreDialog(true)
          }}
        />
        <ToolbarSep />
        <ToolbarButton
          icon={<PanelBottom size={14} />}
          title={showQueryLog ? 'Hide query log' : 'Show query log'}
          active={showQueryLog}
          onClick={() => setShowQueryLog((v) => !v)}
        />
        <ToolbarSep />
        <ToolbarButton
          icon={<Unplug size={13} />}
          title="Disconnect"
          onClick={handleDisconnect}
          className="hover:!text-nd-error"
        />
      </div>

      {/* ── Main content: sidebar + (tab bar + content) ── */}
      {/* Both sidebar and main content are always rendered to avoid unmount/remount cycles.
          Toggling uses CSS hidden (display:none) so React tree stays stable. */}
      <div className="flex flex-row flex-1 overflow-hidden">
        <div
          className={cn(
            'shrink-0 overflow-hidden',
            showSidebar ? 'border-r border-nd-border' : 'hidden'
          )}
          style={showSidebar ? { width: '20%', minWidth: 180, maxWidth: 400 } : undefined}
        >
          <SchemaSidebar
            connectionId={connectionId}
            hasSSHConnection={hasSSHConnection}
            onTableAction={handleTableAction}
            onDatabaseAction={handleDatabaseAction}
          />
        </div>
        <div className="flex-1 overflow-hidden min-w-0">
          {mainContent}
        </div>
      </div>

      {/* ── Query Log bottom panel ── */}
      {showQueryLog && (
        <div
          className="shrink-0 border-t border-nd-border bg-nd-bg-secondary overflow-hidden"
          style={{ height: 160 }}
        >
          <SQLQueryLog connectionId={connectionId} />
        </div>
      )}

      {/* ── Status Bar ── */}
      <SQLStatusBar {...statusBarProps} onSave={handleStatusBarSave} onDiscard={handleStatusBarDiscard} />

      {/* Connect dialog (for reconnect / edit) */}
      <SQLConnectDialog
        open={showConnectDialog}
        onClose={handleCloseConnect}
        connectionId={connectionId}
        sessionId={sessionId}
        isStandalone={isStandalone}
        onNeedDatabasePick={handleNeedDatabasePick}
      />

      {/* Database picker dialog */}
      {showDatabasePicker && (dbPickerSessionId || sqlSessionId) && (
        <DatabasePickerDialog
          open={showDatabasePicker}
          onClose={() => { setShowDatabasePicker(false); setDbPickerSessionId(null) }}
          sqlSessionId={(dbPickerSessionId || sqlSessionId)!}
          onSelect={handleDatabaseSelected}
          dbType={connectionConfig?.type}
        />
      )}

      {/* Export table dialog */}
      {sqlSessionId && connectionConfig && (
        <ExportTableDialog
          open={showExportDialog}
          onClose={() => { setShowExportDialog(false); setExportDialogTable(null) }}
          sqlSessionId={sqlSessionId}
          connectionId={connectionId}
          dbType={connectionConfig.type}
          currentDatabase={currentDatabase}
          table={exportDialogTable}
          tables={tables}
        />
      )}

      {/* Import SQL dialog */}
      {sqlSessionId && connectionConfig && (
        <ImportSQLDialog
          open={showImportSQLDialog}
          onClose={() => setShowImportSQLDialog(false)}
          sqlSessionId={sqlSessionId}
          connectionId={connectionId}
          dbType={connectionConfig.type}
          currentDatabase={currentDatabase}
          isProduction={connectionConfig.isProduction}
        />
      )}

      {/* Import CSV dialog */}
      {sqlSessionId && connectionConfig && (
        <ImportCSVDialog
          open={showImportCSVDialog}
          onClose={() => { setShowImportCSVDialog(false); setImportCSVTable(null) }}
          sqlSessionId={sqlSessionId}
          connectionId={connectionId}
          dbType={connectionConfig.type}
          currentDatabase={currentDatabase}
          tables={tables}
          preSelectedTable={importCSVTable}
          isProduction={connectionConfig.isProduction}
          onFetchColumns={fetchColumnsForTable}
        />
      )}

      {/* Create database dialog */}
      {sqlSessionId && connectionConfig && (
        <CreateDatabaseDialog
          open={showCreateDatabaseDialog}
          onClose={() => setShowCreateDatabaseDialog(false)}
          sqlSessionId={sqlSessionId}
          dbType={connectionConfig.type}
          onCreated={(dbName) => {
            setShowCreateDatabaseDialog(false)
            handleDatabaseSelected(dbName)
          }}
        />
      )}

      {/* Backup/Restore dialog */}
      {sqlSessionId && connectionConfig && (
        <BackupRestoreDialog
          open={showBackupRestoreDialog}
          onClose={() => setShowBackupRestoreDialog(false)}
          sqlSessionId={sqlSessionId}
          connectionId={connectionId}
          dbType={connectionConfig.type}
          currentDatabase={currentDatabase}
          isProduction={connectionConfig.isProduction}
          initialTab={backupRestoreInitialTab}
          dbHost={connectionConfig.host}
          dbPort={connectionConfig.port}
          dbUser={connectionConfig.username}
          dbPassword={connectionConfig.password}
        />
      )}
    </div>
  )
})

export default SQLView
export { SQLView }

// ── Toolbar primitives ──

function ToolbarButton({
  icon,
  title,
  onClick,
  active,
  className,
}: {
  icon: React.ReactNode
  title: string
  onClick: () => void
  active?: boolean
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'flex items-center justify-center w-7 h-7 rounded-sm transition-colors',
        active
          ? 'text-nd-accent bg-nd-accent/10'
          : 'text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface-hover',
        className
      )}
    >
      {icon}
    </button>
  )
}

function ToolbarSep() {
  return <div className="w-px h-4 bg-nd-border mx-0.5 shrink-0" />
}
