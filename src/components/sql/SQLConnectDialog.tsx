import { useState, useCallback, useEffect, useRef } from 'react'
import { cn } from '@/utils/cn'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Toggle'
import { Loader2, CheckCircle2, XCircle, Save, FolderOpen } from 'lucide-react'
import { useSQLConnection } from '@/stores/sqlStore'
import { useConnectionStore } from '@/stores/connectionStore'
import type { DatabaseType, SSLMode, ConnectionTag } from '@/types/sql'

const SSH_AUTH_OPTIONS = [
  { value: 'password', label: 'Password' },
  { value: 'privatekey', label: 'Private Key' },
]

interface SQLConnectDialogProps {
  open: boolean
  onClose: () => void
  connectionId: string
  /** Stable SSH session ID — used for persisting SQL config */
  sessionId: string
  /** When true, defaults to direct connection (no SSH tunnel). Used for standalone DB tabs. */
  isStandalone?: boolean
  /** Called after connecting without a database — triggers database picker */
  onNeedDatabasePick?: (sqlSessionId: string) => void
}

const DB_TYPE_OPTIONS = [
  { value: 'mysql', label: 'MySQL' },
  { value: 'postgres', label: 'PostgreSQL' }
]

const SSL_MODE_OPTIONS = [
  { value: 'disabled', label: 'Disabled' },
  { value: 'preferred', label: 'Preferred' },
  { value: 'required', label: 'Required' },
  { value: 'verify-full', label: 'Verify Full' },
]

const TAG_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'development', label: 'Development' },
  { value: 'staging', label: 'Staging' },
  { value: 'production', label: 'Production' },
  { value: 'testing', label: 'Testing' },
]

const TAG_COLORS: Record<string, string> = {
  none: '',
  development: 'bg-blue-500',
  staging: 'bg-yellow-500',
  production: 'bg-red-500',
  testing: 'bg-green-500',
}

const DEFAULT_PORTS: Record<DatabaseType, string> = {
  mysql: '3306',
  postgres: '5432'
}

type TestStatus = 'idle' | 'testing' | 'success' | 'error'

export function SQLConnectDialog({
  open,
  onClose,
  connectionId,
  sessionId,
  isStandalone,
  onNeedDatabasePick,
}: SQLConnectDialogProps) {
  const [connectionName, setConnectionName] = useState('')
  const [type, setType] = useState<DatabaseType>('mysql')
  const [host, setHost] = useState(isStandalone ? '' : '127.0.0.1')
  const [port, setPort] = useState('3306')
  const [username, setUsername] = useState('root')
  const [password, setPassword] = useState('')
  const [database, setDatabase] = useState('')
  const [useSSHTunnel, setUseSSHTunnel] = useState(!isStandalone)
  const [sslMode, setSslMode] = useState<SSLMode>('disabled')
  const [tag, setTag] = useState<ConnectionTag>('none')
  const [loadedSaved, setLoadedSaved] = useState(false)

  // SSH tunnel config (for standalone mode)
  const [sshHost, setSshHost] = useState('')
  const [sshPort, setSshPort] = useState('22')
  const [sshUsername, setSshUsername] = useState('')
  const [sshAuthMethod, setSshAuthMethod] = useState<'password' | 'privatekey'>('password')
  const [sshPassword, setSshPassword] = useState('')
  const [sshPrivateKeyPath, setSshPrivateKeyPath] = useState('')
  const [sshPassphrase, setSshPassphrase] = useState('')

  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testError, setTestError] = useState<string | null>(null)
  const connectingRef = useRef(false) // Synchronous guard against double-click

  // Reset loaded state when dialog closes so it reloads fresh next time
  useEffect(() => {
    if (!open) setLoadedSaved(false)
  }, [open])

  // Load saved SQL config when dialog opens
  useEffect(() => {
    if (!open || loadedSaved) return
    ;(async () => {
      try {
        const result = await window.novadeck.sql.configGet(sessionId)
        if (result?.success && result.data) {
          const c = result.data
          setConnectionName(c.connectionName ?? '')
          setType(c.type ?? 'mysql')
          setHost(c.host ?? '127.0.0.1')
          const dbType = (c.type ?? 'mysql') as DatabaseType
          setPort(String(c.port ?? DEFAULT_PORTS[dbType]))
          setUsername(c.username ?? 'root')
          setPassword(c.password ?? '')
          setDatabase(c.database ?? '')
          setUseSSHTunnel(c.useSSHTunnel ?? !isStandalone)
          setSslMode(c.sslMode ?? (c.ssl ? 'preferred' : 'disabled'))
          setTag(c.tag ?? (c.isProduction ? 'production' : 'none'))
          // SSH tunnel fields
          setSshHost(c.sshHost ?? '')
          setSshPort(String(c.sshPort ?? 22))
          setSshUsername(c.sshUsername ?? '')
          setSshAuthMethod(c.sshAuthMethod ?? 'password')
          setSshPassword(c.sshPassword ?? '')
          setSshPrivateKeyPath(c.sshPrivateKeyPath ?? '')
          setSshPassphrase(c.sshPassphrase ?? '')
        }
      } catch {
        // Ignore — just use defaults
      }
      setLoadedSaved(true)
    })()
  }, [open, sessionId, loadedSaved])

  const {
    setConnectionStatus,
    setConnectionConfig,
    setCurrentDatabase,
    setSqlSessionId,
    setTunnelPort,
    setConnectionError
  } = useSQLConnection(connectionId)

  const handleTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newType = e.target.value as DatabaseType
      setType(newType)
      if (port === DEFAULT_PORTS[type]) {
        setPort(DEFAULT_PORTS[newType])
      }
    },
    [port, type]
  )

  const buildConfig = useCallback(
    () => {
      const cfg: Record<string, unknown> = {
        type,
        host,
        port: Number(port),
        username,
        password,
        database: database.trim() || undefined,
        useSSHTunnel,
        ssl: sslMode !== 'disabled',
        sslMode,
      }

      // Attach SSH config for standalone tunnels
      if (isStandalone && useSSHTunnel && sshHost) {
        cfg.sshConfig = {
          host: sshHost,
          port: Number(sshPort) || 22,
          username: sshUsername,
          authMethod: sshAuthMethod,
          password: sshAuthMethod === 'password' ? sshPassword : undefined,
          privateKeyPath: sshAuthMethod === 'privatekey' ? sshPrivateKeyPath : undefined,
          passphrase: sshAuthMethod === 'privatekey' ? sshPassphrase : undefined,
        }
      }

      return cfg
    },
    [type, host, port, username, password, database, isStandalone, useSSHTunnel, sslMode,
     sshHost, sshPort, sshUsername, sshAuthMethod, sshPassword, sshPrivateKeyPath, sshPassphrase]
  )

  const buildSavePayload = useCallback(() => {
    return {
      sessionId,
      connectionName,
      type,
      host,
      port: Number(port),
      username,
      password,
      database: database.trim(),
      useSSHTunnel,
      ssl: sslMode !== 'disabled',
      sslMode,
      isProduction: tag === 'production',
      tag,
      // SSH tunnel fields (persisted for standalone mode)
      ...(isStandalone && useSSHTunnel ? {
        sshHost,
        sshPort: Number(sshPort) || 22,
        sshUsername,
        sshAuthMethod,
        sshPassword: sshAuthMethod === 'password' ? sshPassword : undefined,
        sshPrivateKeyPath: sshAuthMethod === 'privatekey' ? sshPrivateKeyPath : undefined,
        sshPassphrase: sshAuthMethod === 'privatekey' ? sshPassphrase : undefined,
      } : {}),
    }
  }, [sessionId, connectionName, type, host, port, username, password, database, useSSHTunnel, sslMode, tag,
      isStandalone, sshHost, sshPort, sshUsername, sshAuthMethod, sshPassword, sshPrivateKeyPath, sshPassphrase])

  const handleSave = useCallback(async () => {
    try {
      await window.novadeck.sql.configSave(buildSavePayload())
    } catch {
      // Ignore save errors
    }
  }, [buildSavePayload])

  const handleTestConnection = useCallback(async () => {
    setTestStatus('testing')
    setTestError(null)

    const testSessionId = `sql-test-${crypto.randomUUID()}`
    try {
      const result = await window.novadeck.sql.connect(
        testSessionId,
        connectionId,
        buildConfig()
      )
      if (result.success) {
        setTestStatus('success')
        await window.novadeck.sql.disconnect(testSessionId)
      } else {
        setTestStatus('error')
        setTestError(result.error || 'Connection failed')
      }
    } catch (err: any) {
      setTestStatus('error')
      setTestError(err.message || String(err))
    }
  }, [connectionId, buildConfig])

  const handleConnect = useCallback(async () => {
    if (connectingRef.current) return
    connectingRef.current = true
    setIsConnecting(true)
    setError(null)
    setConnectionStatus('connecting')

    const sqlSessionId = `sql-${connectionId}-${crypto.randomUUID()}`
    const dbTrimmed = database.trim()
    const isProduction = tag === 'production'

    try {
      const result = await window.novadeck.sql.connect(
        sqlSessionId,
        connectionId,
        buildConfig()
      )

      if (result.success) {
        const resolvedDb = dbTrimmed || result.currentDatabase || ''

        setConnectionStatus('connected')
        setConnectionConfig({
          id: sqlSessionId,
          name: connectionName || `${type}://${host}:${port}/${resolvedDb || 'server'}`,
          type,
          host,
          port: Number(port),
          username,
          password,
          database: resolvedDb,
          useSSHTunnel,
          ssl: sslMode !== 'disabled',
          sslMode,
          isProduction,
          tag,
          connectionName,
        })
        setCurrentDatabase(resolvedDb)
        setSqlSessionId(sqlSessionId)
        setTunnelPort(result.tunnelPort ?? null)
        setConnectionError(null)

        // Persist SQL config for next time
        window.novadeck.sql.configSave(buildSavePayload()).catch(() => {})

        // Update tab name for standalone database tabs
        if (isStandalone) {
          const tabName = connectionName || `${type.toUpperCase()} · ${resolvedDb || host}`
          useConnectionStore.getState().updateTab(connectionId, { sessionName: tabName })
        }

        onClose()

        // If no database was specified, prompt user to pick one
        if (!dbTrimmed && onNeedDatabasePick) {
          onNeedDatabasePick(sqlSessionId)
        }
      } else {
        setConnectionStatus('error')
        setConnectionError(result.error || 'Connection failed')
        setError(result.error || 'Connection failed')
      }
    } catch (err: any) {
      setConnectionStatus('error')
      const msg = err.message || String(err)
      setConnectionError(msg)
      setError(msg)
    } finally {
      setIsConnecting(false)
      connectingRef.current = false
    }
  }, [
    connectionId, connectionName, type, host, port, username, password, database,
    useSSHTunnel, sslMode, tag, isStandalone, buildConfig, buildSavePayload, onClose, onNeedDatabasePick,
    setConnectionStatus, setConnectionConfig, setCurrentDatabase,
    setSqlSessionId, setTunnelPort, setConnectionError
  ])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      handleConnect()
    },
    [handleConnect]
  )

  return (
    <Modal open={open} onClose={onClose} title="Connect to Database" maxWidth="max-w-lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Connection Name + Tag */}
        <div className="grid grid-cols-[1fr_140px] gap-3">
          <Input
            label="Connection Name"
            value={connectionName}
            onChange={(e) => setConnectionName(e.target.value)}
            placeholder="My Database"
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-nd-text-secondary">Tag</label>
            <div className="flex items-center gap-2">
              {tag !== 'none' && (
                <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', TAG_COLORS[tag])} />
              )}
              <select
                value={tag}
                onChange={(e) => setTag(e.target.value as ConnectionTag)}
                className="flex-1 h-8 rounded-md border border-nd-border bg-nd-surface px-2 text-xs text-nd-text-primary outline-none focus:border-nd-accent"
              >
                {TAG_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Database type */}
        <Select
          label="Type"
          options={DB_TYPE_OPTIONS}
          value={type}
          onChange={handleTypeChange}
        />

        {/* Host + Port */}
        <div className="grid grid-cols-[1fr_100px] gap-3">
          <Input
            label="Host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder={isStandalone ? 'localhost or IP address' : '127.0.0.1'}
          />
          <Input
            label="Port"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder={DEFAULT_PORTS[type]}
            type="number"
          />
        </div>

        {/* Username */}
        <Input
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="root"
        />

        {/* Password */}
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />

        {/* Database (optional) */}
        <Input
          label="Database"
          value={database}
          onChange={(e) => setDatabase(e.target.value)}
          placeholder="Optional — leave empty to choose later"
        />
        {!database.trim() && (
          <p className="text-2xs text-nd-text-muted -mt-3">
            You can connect without a database and select one after connecting.
          </p>
        )}

        {/* SSL Mode */}
        <Select
          label="SSL Mode"
          options={SSL_MODE_OPTIONS}
          value={sslMode}
          onChange={(e) => setSslMode(e.target.value as SSLMode)}
        />

        {/* SSH Tunnel toggle */}
        <div className="flex flex-col gap-3 pt-1">
          <Toggle
            checked={useSSHTunnel}
            onChange={setUseSSHTunnel}
            label="Route through SSH tunnel"
          />
        </div>

        {/* SSH Tunnel configuration (standalone mode only — SSH session tabs use the active SSH connection) */}
        {isStandalone && useSSHTunnel && (
          <div className="flex flex-col gap-3 rounded-lg border border-nd-border bg-nd-bg-secondary/50 p-3">
            <p className="text-2xs font-semibold text-nd-text-muted uppercase tracking-wider">SSH Server</p>

            {/* SSH Host + Port */}
            <div className="grid grid-cols-[1fr_80px] gap-3">
              <Input
                label="SSH Host"
                value={sshHost}
                onChange={(e) => setSshHost(e.target.value)}
                placeholder="server.example.com"
              />
              <Input
                label="SSH Port"
                value={sshPort}
                onChange={(e) => setSshPort(e.target.value)}
                placeholder="22"
                type="number"
              />
            </div>

            {/* SSH Username */}
            <Input
              label="SSH Username"
              value={sshUsername}
              onChange={(e) => setSshUsername(e.target.value)}
              placeholder="root"
            />

            {/* SSH Auth method */}
            <Select
              label="Authentication"
              options={SSH_AUTH_OPTIONS}
              value={sshAuthMethod}
              onChange={(e) => setSshAuthMethod(e.target.value as 'password' | 'privatekey')}
            />

            {sshAuthMethod === 'password' ? (
              <Input
                label="SSH Password"
                type="password"
                value={sshPassword}
                onChange={(e) => setSshPassword(e.target.value)}
                placeholder="SSH Password"
              />
            ) : (
              <>
                {/* Private Key Path */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-nd-text-secondary">Private Key</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={sshPrivateKeyPath}
                      onChange={(e) => setSshPrivateKeyPath(e.target.value)}
                      placeholder="Path to private key file"
                      className="flex-1 h-8 rounded-md border border-nd-border bg-nd-surface px-3 text-xs text-nd-text-primary placeholder:text-nd-text-muted outline-none focus:border-nd-accent transition-colors"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        const result = await (window as any).novadeck.dialog.openFile({
                          title: 'Select SSH Private Key',
                          filters: [{ name: 'All Files', extensions: ['*'] }],
                          properties: ['openFile'],
                        })
                        if (result?.filePaths?.[0]) {
                          setSshPrivateKeyPath(result.filePaths[0])
                        }
                      }}
                    >
                      <FolderOpen size={14} />
                    </Button>
                  </div>
                </div>

                {/* Passphrase */}
                <Input
                  label="Passphrase"
                  type="password"
                  value={sshPassphrase}
                  onChange={(e) => setSshPassphrase(e.target.value)}
                  placeholder="Key passphrase (if any)"
                />
              </>
            )}
          </div>
        )}

        {/* Test connection */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleTestConnection}
            disabled={testStatus === 'testing' || isConnecting}
          >
            {testStatus === 'testing' && <Loader2 size={14} className="animate-spin" />}
            {testStatus === 'success' && <CheckCircle2 size={14} className="text-green-500" />}
            {testStatus === 'error' && <XCircle size={14} className="text-nd-error" />}
            Test Connection
          </Button>
          {testStatus === 'success' && (
            <span className="text-xs text-green-500">Connected successfully</span>
          )}
          {testStatus === 'error' && testError && (
            <span className="text-xs text-nd-error truncate max-w-[200px]" title={testError}>
              {testError}
            </span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-md bg-nd-error/10 border border-nd-error/20 px-3 py-2">
            <p className="text-xs text-nd-error">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className={cn('flex gap-2 justify-end pt-2 border-t border-nd-border')}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isConnecting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={handleSave}
            disabled={isConnecting}
            title="Save without connecting"
          >
            <Save size={14} />
            Save
          </Button>
          <Button type="submit" variant="primary" disabled={isConnecting}>
            {isConnecting && <Loader2 size={14} className="animate-spin" />}
            Connect
          </Button>
        </div>
      </form>
    </Modal>
  )
}
