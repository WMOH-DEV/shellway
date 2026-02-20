import { useState, useCallback, useEffect } from 'react'
import { cn } from '@/utils/cn'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Toggle'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { useSQLConnection } from '@/stores/sqlStore'
import type { DatabaseType } from '@/types/sql'

interface SQLConnectDialogProps {
  open: boolean
  onClose: () => void
  connectionId: string
}

const DB_TYPE_OPTIONS = [
  { value: 'mysql', label: 'MySQL' },
  { value: 'postgres', label: 'PostgreSQL' }
]

const DEFAULT_PORTS: Record<DatabaseType, string> = {
  mysql: '3306',
  postgres: '5432'
}

type TestStatus = 'idle' | 'testing' | 'success' | 'error'

export function SQLConnectDialog({ open, onClose, connectionId }: SQLConnectDialogProps) {
  const [type, setType] = useState<DatabaseType>('mysql')
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('3306')
  const [username, setUsername] = useState('root')
  const [password, setPassword] = useState('')
  const [database, setDatabase] = useState('')
  const [useSSHTunnel, setUseSSHTunnel] = useState(true)
  const [isProduction, setIsProduction] = useState(false)
  const [ssl, setSsl] = useState(false)
  const [loadedSaved, setLoadedSaved] = useState(false)

  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testError, setTestError] = useState<string | null>(null)

  // Load saved SQL config when dialog opens
  useEffect(() => {
    if (!open || loadedSaved) return
    ;(async () => {
      try {
        const result = await (window as any).novadeck.sql.configGet(connectionId)
        if (result?.success && result.data) {
          const c = result.data
          setType(c.type ?? 'mysql')
          setHost(c.host ?? '127.0.0.1')
          const dbType = (c.type ?? 'mysql') as DatabaseType
          setPort(String(c.port ?? DEFAULT_PORTS[dbType]))
          setUsername(c.username ?? 'root')
          setPassword(c.password ?? '')
          setDatabase(c.database ?? '')
          setUseSSHTunnel(c.useSSHTunnel ?? true)
          setIsProduction(c.isProduction ?? false)
          setSsl(c.ssl ?? false)
        }
      } catch {
        // Ignore — just use defaults
      }
      setLoadedSaved(true)
    })()
  }, [open, connectionId, loadedSaved])

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
      // Update port to default if it was still at the old default
      if (port === DEFAULT_PORTS[type]) {
        setPort(DEFAULT_PORTS[newType])
      }
    },
    [port, type]
  )

  const buildConfig = useCallback(
    () => ({
      type,
      host,
      port: Number(port),
      username,
      password,
      database,
      useSSHTunnel,
      ssl
    }),
    [type, host, port, username, password, database, useSSHTunnel, ssl]
  )

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
        // Disconnect the test connection
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
    if (!database.trim()) {
      setError('Database name is required')
      return
    }

    setIsConnecting(true)
    setError(null)
    setConnectionStatus('connecting')

    const sqlSessionId = `sql-${connectionId}-${crypto.randomUUID()}`

    try {
      const result = await window.novadeck.sql.connect(
        sqlSessionId,
        connectionId,
        buildConfig()
      )

      if (result.success) {
        setConnectionStatus('connected')
        setConnectionConfig({
          id: sqlSessionId,
          name: `${type}://${host}:${port}/${database}`,
          type,
          host,
          port: Number(port),
          username,
          password,
          database,
          useSSHTunnel,
          ssl,
          isProduction
        })
        setCurrentDatabase(database)
        setSqlSessionId(sqlSessionId)
        setTunnelPort(result.tunnelPort ?? null)
        setConnectionError(null)

        // Persist SQL config for next time
        ;(window as any).novadeck.sql.configSave({
          sessionId: connectionId,
          type,
          host,
          port: Number(port),
          username,
          password,
          database,
          useSSHTunnel,
          ssl,
          isProduction,
        }).catch(() => {})

        onClose()
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
    }
  }, [
    connectionId, type, host, port, username, password, database,
    useSSHTunnel, ssl, isProduction, buildConfig, onClose,
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
    <Modal open={open} onClose={onClose} title="Connect to Database" maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
            placeholder="127.0.0.1"
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

        {/* Database */}
        <Input
          label="Database"
          value={database}
          onChange={(e) => setDatabase(e.target.value)}
          placeholder="myapp"
          error={!database.trim() && error ? 'Required' : undefined}
        />

        {/* Toggles */}
        <div className="flex flex-col gap-3 pt-1">
          <Toggle
            checked={useSSHTunnel}
            onChange={setUseSSHTunnel}
            label="Route through SSH tunnel"
          />
          <Toggle
            checked={isProduction}
            onChange={setIsProduction}
            label="Production environment"
          />
          <Toggle
            checked={ssl}
            onChange={setSsl}
            label="Use SSL"
          />
        </div>

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
          <Button type="submit" variant="primary" disabled={isConnecting}>
            {isConnecting && <Loader2 size={14} className="animate-spin" />}
            Connect
          </Button>
        </div>
      </form>
    </Modal>
  )
}
