import { useState, useCallback, useEffect, useRef } from 'react'
import {
  HardDrive,
  RotateCcw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  FileText,
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { formatFileSize } from '@/utils/fileSize'
import type { DatabaseType, TransferProgress } from '@/types/sql'

// ── Types ──

interface BackupRestoreDialogProps {
  open: boolean
  onClose: () => void
  sqlSessionId: string
  connectionId: string
  dbType: DatabaseType
  currentDatabase: string
  isProduction?: boolean
  /** Initial tab: 'backup' or 'restore' */
  initialTab?: 'backup' | 'restore'
  /** DB credentials needed for SSH exec commands */
  dbHost?: string
  dbPort?: number
  dbUser?: string
  dbPassword?: string
}

type ActiveTab = 'backup' | 'restore'
type OperationPhase = 'options' | 'running' | 'complete'

// ── Helpers ──

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}m ${s}s`
}

// ── Component ──

export function BackupRestoreDialog({
  open,
  onClose,
  sqlSessionId,
  connectionId,
  dbType,
  currentDatabase,
  isProduction,
  initialTab = 'backup',
  dbHost = '127.0.0.1',
  dbPort,
  dbUser = '',
  dbPassword = '',
}: BackupRestoreDialogProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab)

  // ── Backup state ──
  const [backupPhase, setBackupPhase] = useState<OperationPhase>('options')

  // MySQL backup options
  const [mysqlSingleTransaction, setMysqlSingleTransaction] = useState(true)
  const [mysqlDropTable, setMysqlDropTable] = useState(true)
  const [mysqlExtendedInsert, setMysqlExtendedInsert] = useState(true)
  const [mysqlRoutines, setMysqlRoutines] = useState(false)
  const [mysqlEvents, setMysqlEvents] = useState(false)
  const [mysqlTriggers, setMysqlTriggers] = useState(true)

  // PostgreSQL backup options
  const [pgNoOwner, setPgNoOwner] = useState(false)
  const [pgNoPrivileges, setPgNoPrivileges] = useState(false)
  const [pgInserts, setPgInserts] = useState(false)

  // Shared backup options
  const [backupScope, setBackupScope] = useState<'both' | 'structure' | 'data'>('both')

  // ── Restore state ──
  const [restorePhase, setRestorePhase] = useState<OperationPhase>('options')
  const [restoreFilePath, setRestoreFilePath] = useState<string | null>(null)
  const [restoreFileName, setRestoreFileName] = useState<string | null>(null)
  const [restoreFileSize, setRestoreFileSize] = useState<number | null>(null)

  // ── Shared ──
  const [operationId, setOperationId] = useState<string | null>(null)
  const [progress, setProgress] = useState<TransferProgress | null>(null)
  const [operationErrors, setOperationErrors] = useState<string[]>([])
  const [elapsed, setElapsed] = useState(0)
  const startTimeRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const effectivePort = dbPort ?? (dbType === 'mysql' ? 3306 : 5432)
  const activeTabRef = useRef<ActiveTab>(initialTab)
  activeTabRef.current = activeTab

  // ── Reset on close ──

  useEffect(() => {
    if (!open) {
      setActiveTab(initialTab)
      setBackupPhase('options')
      setRestorePhase('options')
      setRestoreFilePath(null)
      setRestoreFileName(null)
      setRestoreFileSize(null)
      setMysqlSingleTransaction(true)
      setMysqlDropTable(true)
      setMysqlExtendedInsert(true)
      setMysqlRoutines(false)
      setMysqlEvents(false)
      setMysqlTriggers(true)
      setPgNoOwner(false)
      setPgNoPrivileges(false)
      setPgInserts(false)
      setBackupScope('both')
      setOperationId(null)
      setProgress(null)
      setOperationErrors([])
      setElapsed(0)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [open, initialTab])

  // ── Elapsed timer ──

  const isRunning = backupPhase === 'running' || restorePhase === 'running'

  useEffect(() => {
    if (isRunning) {
      startTimeRef.current = Date.now()
      timerRef.current = setInterval(() => {
        setElapsed(Date.now() - startTimeRef.current)
      }, 500)
    } else if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isRunning])

  // ── Progress listener ──

  useEffect(() => {
    if (!operationId) return

    const unsub = (window as any).novadeck.sql.onTransferProgress(
      (_sessionId: string, p: TransferProgress) => {
        if (p.operationId !== operationId) return

        setProgress(p)

        if (p.error) {
          setOperationErrors((prev) => [...prev, p.error!])
        }

        if (p.status === 'completed' || p.status === 'failed' || p.status === 'cancelled') {
          setElapsed(Date.now() - startTimeRef.current)
          // Use ref to avoid stale closure — tab is stable during an operation
          if (activeTabRef.current === 'backup') {
            setBackupPhase('complete')
          } else {
            setRestorePhase('complete')
          }
        }
      }
    )

    return unsub
  }, [operationId])

  // ── Backup ──

  const handleBackup = useCallback(async () => {
    try {
      const result = await (window as any).novadeck.dialog.saveFile({
        title: 'Save Backup As',
        defaultPath: `${currentDatabase}_backup.sql`,
        filters: [{ name: 'SQL Files', extensions: ['sql'] }],
      })

      if (result.canceled || !result.filePath) return

      const filePath = result.filePath as string

      setBackupPhase('running')
      setOperationErrors([])
      setProgress(null)

      // Build backup options
      const extraArgs: string[] = []
      if (dbType === 'mysql') {
        if (mysqlSingleTransaction) extraArgs.push('--single-transaction')
        if (mysqlDropTable) extraArgs.push('--add-drop-table')
        if (mysqlExtendedInsert) extraArgs.push('--extended-insert')
        if (mysqlRoutines) extraArgs.push('--routines')
        if (mysqlEvents) extraArgs.push('--events')
        if (mysqlTriggers) extraArgs.push('--triggers')
      } else {
        if (pgNoOwner) extraArgs.push('--no-owner')
        if (pgNoPrivileges) extraArgs.push('--no-privileges')
        if (pgInserts) extraArgs.push('--inserts')
      }

      const res = await (window as any).novadeck.sql.backup(
        sqlSessionId,
        currentDatabase,
        filePath,
        {
          includeStructure: backupScope !== 'data',
          includeData: backupScope !== 'structure',
          extraArgs: extraArgs.length > 0 ? extraArgs : undefined,
          dbHost,
          dbPort: effectivePort,
          dbUser,
          dbPassword,
        }
      )

      if (res.success && res.operationId) {
        setOperationId(res.operationId)
      } else {
        setOperationErrors([res.error || 'Backup failed to start'])
        setBackupPhase('complete')
      }
    } catch (err) {
      setOperationErrors([err instanceof Error ? err.message : String(err)])
      setBackupPhase('complete')
    }
  }, [
    sqlSessionId, currentDatabase, dbType, backupScope, dbHost, effectivePort, dbUser, dbPassword,
    mysqlSingleTransaction, mysqlDropTable, mysqlExtendedInsert, mysqlRoutines, mysqlEvents, mysqlTriggers,
    pgNoOwner, pgNoPrivileges, pgInserts,
  ])

  // ── Restore ──

  const handleChooseRestoreFile = useCallback(async () => {
    try {
      const result = await (window as any).novadeck.dialog.openFile({
        title: 'Choose Backup File',
        filters: [
          { name: 'SQL/Dump Files', extensions: ['sql', 'dump', 'tar', 'gz'] },
        ],
      })

      if (result.canceled || !result.filePaths?.length) return

      const selected = result.filePaths[0] as string
      const name = selected.split(/[/\\]/).pop() || selected
      setRestoreFilePath(selected)
      setRestoreFileName(name)
      // File size will be shown from progress when available
      setRestoreFileSize(null)
    } catch {
      // Silently fail
    }
  }, [])

  const handleRestore = useCallback(async () => {
    if (!restoreFilePath) return

    setRestorePhase('running')
    setOperationErrors([])
    setProgress(null)

    try {
      const res = await (window as any).novadeck.sql.restore(
        sqlSessionId,
        currentDatabase,
        restoreFilePath,
        {
          dbHost,
          dbPort: effectivePort,
          dbUser,
          dbPassword,
        }
      )

      if (res.success && res.operationId) {
        setOperationId(res.operationId)
      } else {
        setOperationErrors([res.error || 'Restore failed to start'])
        setRestorePhase('complete')
      }
    } catch (err) {
      setOperationErrors([err instanceof Error ? err.message : String(err)])
      setRestorePhase('complete')
    }
  }, [restoreFilePath, sqlSessionId, currentDatabase, dbHost, effectivePort, dbUser, dbPassword])

  // ── Cancel ──

  const handleCancel = useCallback(async () => {
    if (!operationId) return
    try {
      await (window as any).novadeck.sql.cancelTransfer(operationId)
    } catch {
      // Best effort
    }
  }, [operationId])

  // ── Computed ──

  const handleSwitchTab = useCallback((tab: ActiveTab) => {
    if (tab === activeTab) return
    // Reset shared state when switching tabs (only possible in options phase)
    setOperationId(null)
    setProgress(null)
    setOperationErrors([])
    setElapsed(0)
    setActiveTab(tab)
  }, [activeTab])

  const currentPhase = activeTab === 'backup' ? backupPhase : restorePhase
  const preventClose = currentPhase === 'running'
  const isCompleted = progress?.status === 'completed'
  const isCancelled = progress?.status === 'cancelled'
  const isFailed = progress?.status === 'failed'
  const processedBytes = progress?.processedBytes ?? 0
  const totalBytes = progress?.totalBytes ?? 0
  const currentMessage = progress?.message ?? ''
  const progressPercentage = progress?.percentage ?? -1

  return (
    <Modal
      open={open}
      onClose={preventClose ? () => {} : onClose}
      title="Backup / Restore"
      maxWidth="max-w-lg"
      closeOnBackdrop={!preventClose}
      closeOnEscape={!preventClose}
    >
      <div className="flex flex-col gap-4">
        {/* Production warning */}
        {isProduction && (
          <div className="flex items-start gap-2.5 rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2.5">
            <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs font-medium text-red-400">
              You are working with a PRODUCTION database. Proceed with extreme caution.
            </p>
          </div>
        )}

        {/* Tab switcher */}
        {currentPhase === 'options' && (
          <div className="flex border-b border-nd-border">
            <button
              onClick={() => handleSwitchTab('backup')}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px',
                activeTab === 'backup'
                  ? 'text-nd-accent border-nd-accent'
                  : 'text-nd-text-muted border-transparent hover:text-nd-text-secondary'
              )}
            >
              <HardDrive size={13} />
              Backup
            </button>
            <button
              onClick={() => handleSwitchTab('restore')}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px',
                activeTab === 'restore'
                  ? 'text-nd-accent border-nd-accent'
                  : 'text-nd-text-muted border-transparent hover:text-nd-text-secondary'
              )}
            >
              <RotateCcw size={13} />
              Restore
            </button>
          </div>
        )}

        {/* ── Backup Options ── */}
        {activeTab === 'backup' && backupPhase === 'options' && (
          <>
            {/* Database info */}
            <div>
              <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
                Database
              </label>
              <input
                type="text"
                value={currentDatabase}
                readOnly
                className="w-full px-2.5 py-1.5 rounded-md bg-nd-surface border border-nd-border text-xs text-nd-text-primary font-mono"
              />
            </div>

            {/* Scope */}
            <div>
              <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
                Content
              </label>
              <div className="flex gap-3">
                {(['both', 'structure', 'data'] as const).map((scope) => (
                  <label
                    key={scope}
                    className="flex items-center gap-1.5 text-xs text-nd-text-primary cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="backupScope"
                      value={scope}
                      checked={backupScope === scope}
                      onChange={() => setBackupScope(scope)}
                      className="accent-nd-accent"
                    />
                    {scope === 'both' ? 'Structure + Data' : scope === 'structure' ? 'Structure Only' : 'Data Only'}
                  </label>
                ))}
              </div>
            </div>

            {/* DB-specific options */}
            <div>
              <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
                {dbType === 'mysql' ? 'MySQL Options' : 'PostgreSQL Options'}
              </label>
              <div className="space-y-2">
                {dbType === 'mysql' ? (
                  <>
                    <Checkbox label="Single transaction (--single-transaction)" checked={mysqlSingleTransaction} onChange={setMysqlSingleTransaction} />
                    <Checkbox label="Add DROP TABLE (--add-drop-table)" checked={mysqlDropTable} onChange={setMysqlDropTable} />
                    <Checkbox label="Extended inserts (--extended-insert)" checked={mysqlExtendedInsert} onChange={setMysqlExtendedInsert} />
                    <Checkbox label="Include routines (--routines)" checked={mysqlRoutines} onChange={setMysqlRoutines} />
                    <Checkbox label="Include events (--events)" checked={mysqlEvents} onChange={setMysqlEvents} />
                    <Checkbox label="Include triggers (--triggers)" checked={mysqlTriggers} onChange={setMysqlTriggers} />
                  </>
                ) : (
                  <>
                    <Checkbox label="No owner (--no-owner)" checked={pgNoOwner} onChange={setPgNoOwner} />
                    <Checkbox label="No privileges (--no-privileges)" checked={pgNoPrivileges} onChange={setPgNoPrivileges} />
                    <Checkbox label="Use INSERT instead of COPY (--inserts)" checked={pgInserts} onChange={setPgInserts} />
                  </>
                )}
              </div>
            </div>

            {/* Credentials note */}
            {!dbUser && (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2">
                <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-400">
                  Database credentials are required for backup. They should be passed from the connection config.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleBackup}
                disabled={!dbUser}
              >
                <HardDrive size={13} />
                Backup
              </Button>
            </div>
          </>
        )}

        {/* ── Restore Options ── */}
        {activeTab === 'restore' && restorePhase === 'options' && (
          <>
            {/* Database info */}
            <div>
              <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
                Target Database
              </label>
              <input
                type="text"
                value={currentDatabase}
                readOnly
                className="w-full px-2.5 py-1.5 rounded-md bg-nd-surface border border-nd-border text-xs text-nd-text-primary font-mono"
              />
            </div>

            {/* File selector */}
            <div>
              <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
                Backup File
              </label>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={handleChooseRestoreFile}>
                  <FileText size={13} />
                  Choose File
                </Button>
              </div>

              {restoreFileName && (
                <div className="mt-2 rounded-md bg-nd-surface border border-nd-border px-3 py-2 text-xs text-nd-text-secondary space-y-0.5">
                  <p>
                    <span className="text-nd-text-primary font-medium">{restoreFileName}</span>
                  </p>
                  {restoreFilePath && (
                    <p className="text-nd-text-muted truncate" title={restoreFilePath}>
                      {restoreFilePath}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Restore warning */}
            {restoreFilePath && (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2">
                <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-400">
                  Restoring will execute SQL statements against <span className="font-mono font-medium">{currentDatabase}</span>.
                  Existing data may be modified or deleted.
                </p>
              </div>
            )}

            {/* Credentials note */}
            {!dbUser && (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2">
                <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-400">
                  Database credentials are required for restore.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleRestore}
                disabled={!restoreFilePath || !dbUser}
              >
                <RotateCcw size={13} />
                Restore
              </Button>
            </div>
          </>
        )}

        {/* ── Running phase ── */}
        {currentPhase === 'running' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs text-nd-text-secondary">
              <Loader2 size={14} className="animate-spin text-nd-accent" />
              <span>
                {activeTab === 'backup' ? 'Backing up' : 'Restoring'} <span className="font-mono font-medium">{currentDatabase}</span>...
              </span>
            </div>

            {/* Progress bar (indeterminate or bytes-based) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-nd-text-secondary">
                  {currentMessage || (activeTab === 'backup' ? 'Running backup...' : 'Running restore...')}
                </span>
                {processedBytes > 0 && (
                  <span className="text-xs text-nd-text-muted">
                    {formatFileSize(processedBytes)}
                    {totalBytes > 0 ? ` / ${formatFileSize(totalBytes)}` : ''}
                  </span>
                )}
              </div>
              <div className="h-1.5 rounded-full bg-nd-surface overflow-hidden">
                {progressPercentage >= 0 ? (
                  <div
                    className="h-full rounded-full bg-nd-accent transition-all duration-300"
                    style={{ width: `${Math.max(0, Math.min(100, progressPercentage))}%` }}
                  />
                ) : (
                  <div className="h-full rounded-full bg-nd-accent animate-pulse w-full opacity-30" />
                )}
              </div>
            </div>

            {/* Elapsed */}
            <div className="flex items-center text-xs text-nd-text-muted">
              <Clock size={12} className="mr-1" />
              {formatElapsed(elapsed)}
            </div>

            {/* Cancel */}
            <div className="flex justify-end pt-1">
              <Button variant="danger" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* ── Complete phase ── */}
        {currentPhase === 'complete' && (
          <div className="flex flex-col gap-3">
            {/* Status */}
            <div className="flex items-center gap-2">
              {isCompleted && operationErrors.length === 0 && (
                <>
                  <CheckCircle size={16} className="text-green-400" />
                  <span className="text-sm font-medium text-green-400">
                    {activeTab === 'backup' ? 'Backup' : 'Restore'} completed
                  </span>
                </>
              )}
              {isCompleted && operationErrors.length > 0 && (
                <>
                  <AlertTriangle size={16} className="text-amber-400" />
                  <span className="text-sm font-medium text-amber-400">
                    Completed with warnings
                  </span>
                </>
              )}
              {isFailed && (
                <>
                  <XCircle size={16} className="text-red-400" />
                  <span className="text-sm font-medium text-red-400">
                    {activeTab === 'backup' ? 'Backup' : 'Restore'} failed
                  </span>
                </>
              )}
              {isCancelled && (
                <>
                  <XCircle size={16} className="text-nd-text-muted" />
                  <span className="text-sm font-medium text-nd-text-muted">Cancelled</span>
                </>
              )}
            </div>

            {/* Summary */}
            <div className="rounded-md bg-nd-surface border border-nd-border px-3 py-2.5 space-y-1 text-xs text-nd-text-secondary">
              <p>
                Operation:{' '}
                <span className="text-nd-text-primary font-medium">
                  {activeTab === 'backup' ? 'Backup' : 'Restore'}
                </span>
              </p>
              <p>
                Database:{' '}
                <span className="text-nd-text-primary font-medium font-mono">{currentDatabase}</span>
              </p>
              {processedBytes > 0 && (
                <p>
                  Size:{' '}
                  <span className="text-nd-text-primary font-medium">
                    {formatFileSize(processedBytes)}
                  </span>
                </p>
              )}
              <p>
                Time:{' '}
                <span className="text-nd-text-primary font-medium">{formatElapsed(elapsed)}</span>
              </p>
            </div>

            {/* Errors */}
            {operationErrors.length > 0 && (
              <div className="max-h-32 overflow-y-auto rounded-md bg-red-500/5 border border-red-500/20 px-3 py-2 space-y-1">
                {operationErrors.map((err, i) => (
                  <p key={i} className="text-[11px] font-mono text-red-400 break-all">
                    {err}
                  </p>
                ))}
              </div>
            )}

            {/* Close */}
            <div className="flex justify-end pt-1">
              <Button variant="secondary" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── Helper components ──

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded accent-nd-accent"
      />
      {label}
    </label>
  )
}
