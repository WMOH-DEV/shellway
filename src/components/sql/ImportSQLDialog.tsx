import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  ChevronDown,
  RotateCcw,
  X as XIcon,
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { formatFileSize } from '@/utils/fileSize'
import type { DatabaseType, HealRunMode, TransferProgress } from '@/types/sql'
import { RunModeSelector } from './RunModeSelector'

// ── Types ──

interface ImportSQLDialogProps {
  open: boolean
  onClose: () => void
  sqlSessionId: string
  connectionId: string
  dbType: DatabaseType
  currentDatabase: string
  isProduction?: boolean
  /**
   * When set, the dialog auto-selects this file and triggers the pre-scan
   * on open. Used by the "Open quarantine" flow to re-import skipped stmts.
   */
  initialFilePath?: string | null
  /** Callback to reopen the dialog on a quarantine file (fed to parent). */
  onOpenQuarantine?: (path: string) => void
}

interface PreScanResult {
  statementCount: number
  dangerousStatements: string[]
  fileSize: number
  referencedTables?: string[]
  charsets?: string[]
  insertCount?: number
  createTableCount?: number
  dropTableCount?: number
}

interface PreflightTableInfo {
  present: string[]
  missing: string[]
}

interface TransferCheckpointDTO {
  operationId: string
  filePath: string
  label: string
  stmtIndex: number
  processedBytes: number
  totalBytes: number
  dbType: 'mysql' | 'postgres'
  runMode: HealRunMode
  updatedAt: number
  database?: string
}

type ImportPhase = 'select' | 'ready' | 'importing' | 'complete'

// ── Helpers ──

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}m ${s}s`
}

// ── Component ──

export function ImportSQLDialog({
  open,
  onClose,
  sqlSessionId,
  connectionId,
  dbType,
  currentDatabase,
  isProduction,
  initialFilePath = null,
  onOpenQuarantine,
}: ImportSQLDialogProps) {
  // File selection
  const [filePath, setFilePath] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  // Pre-scan
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<PreScanResult | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [dangerAcknowledged, setDangerAcknowledged] = useState(false)

  // Options
  const [useTransaction, setUseTransaction] = useState(false)
  const [runMode, setRunMode] = useState<HealRunMode>('smart')
  const [dryRun, setDryRun] = useState(false)

  // Resumable checkpoints (interrupted imports)
  const [checkpoints, setCheckpoints] = useState<TransferCheckpointDTO[]>([])

  // Preflight: present/missing tables on target
  const [preflight, setPreflight] = useState<PreflightTableInfo | null>(null)

  // Import state
  const [phase, setPhase] = useState<ImportPhase>('select')
  const [operationId, setOperationId] = useState<string | null>(null)
  const operationIdRef = useRef<string | null>(null)
  const [progress, setProgress] = useState<TransferProgress | null>(null)
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [errorsExpanded, setErrorsExpanded] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const startTimeRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const errorListRef = useRef<HTMLDivElement>(null)

  // Auto-scroll error list to latest error
  useEffect(() => {
    if (errorsExpanded && errorListRef.current) {
      errorListRef.current.scrollTop = errorListRef.current.scrollHeight
    }
  }, [importErrors.length, errorsExpanded])

  const hasDangerousStatements = (scanResult?.dangerousStatements.length ?? 0) > 0

  const canImport =
    phase === 'ready' &&
    filePath &&
    scanResult &&
    (!hasDangerousStatements || dangerAcknowledged)

  // ── Reset on close/open ──

  useEffect(() => {
    if (!open) {
      setFilePath(null)
      setFileName(null)
      setScanning(false)
      setScanResult(null)
      setScanError(null)
      setDangerAcknowledged(false)
      setUseTransaction(false)
      setRunMode('smart')
      setDryRun(false)
      setPreflight(null)
      setPhase('select')
      setOperationId(null)
      setProgress(null)
      setImportErrors([])
      setErrorsExpanded(false)
      setElapsed(0)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [open])

  // ── Elapsed timer ──

  useEffect(() => {
    if (phase === 'importing') {
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
  }, [phase])

  // ── Progress listener ──
  // Register BEFORE the import starts (when phase becomes 'importing')
  // to avoid missing early progress events. Use operationIdRef to filter.

  useEffect(() => {
    if (phase !== 'importing') return

    const unsub = (window as any).novadeck.sql.onTransferProgress(
      (sessionId: string, p: TransferProgress) => {
        if (sessionId !== sqlSessionId) return
        if (operationIdRef.current && p.operationId !== operationIdRef.current) return

        setProgress(p)

        if (p.error) {
          setImportErrors((prev) => [...prev, p.error!])
        }

        if (p.status === 'completed' || p.status === 'failed' || p.status === 'cancelled') {
          setElapsed(Date.now() - startTimeRef.current)
          setPhase('complete')
        }
      }
    )

    return unsub
  }, [phase, sqlSessionId])

  // ── Fetch resumable checkpoints on open ──
  useEffect(() => {
    if (!open) {
      setCheckpoints([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await (window as any).novadeck.sql.listTransferCheckpoints?.()
        if (cancelled) return
        if (res?.success && Array.isArray(res.data)) {
          setCheckpoints(res.data as TransferCheckpointDTO[])
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const handleResume = useCallback(async (cp: TransferCheckpointDTO) => {
    setImportErrors([])
    setProgress(null)
    operationIdRef.current = null
    setPhase('importing')
    try {
      const result = await (window as any).novadeck.sql.importSQL(sqlSessionId, cp.filePath, {
        useTransaction: false,
        onError: 'skip',
        runMode: cp.runMode,
        skipFirst: cp.stmtIndex,
        database: cp.database,
      })
      if (result.success && result.operationId) {
        operationIdRef.current = result.operationId
        setOperationId(result.operationId)
      } else {
        setImportErrors([result.error || 'Resume failed to start'])
        setPhase('complete')
      }
    } catch (err) {
      setImportErrors([err instanceof Error ? err.message : String(err)])
      setPhase('complete')
    }
  }, [sqlSessionId])

  const handleDiscardCheckpoint = useCallback(async (cp: TransferCheckpointDTO) => {
    try {
      await (window as any).novadeck.sql.deleteTransferCheckpoint?.(cp.operationId)
    } catch { /* ignore */ }
    setCheckpoints((prev) => prev.filter((c) => c.operationId !== cp.operationId))
  }, [])

  const handleDownloadReport = useCallback(() => {
    const report = {
      tool: 'shellway',
      file: filePath,
      fileName,
      database: currentDatabase,
      dbType,
      startedAt: startTimeRef.current ? new Date(startTimeRef.current).toISOString() : null,
      elapsedMs: elapsed,
      status: progress?.status ?? 'unknown',
      runMode,
      stats: progress?.stats ?? null,
      quarantinePath: progress?.quarantinePath ?? null,
      errors: importErrors,
      prescan: scanResult,
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `shellway-import-report-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [filePath, fileName, currentDatabase, dbType, elapsed, progress, runMode, importErrors, scanResult])

  // ── Auto-load the initial file (quarantine re-import flow) ──

  const runPreflight = useCallback(async (scan: PreScanResult) => {
    if (!scan.referencedTables || scan.referencedTables.length === 0) return
    try {
      const res = await (window as any).novadeck.sql.preflightTables?.(
        sqlSessionId,
        scan.referencedTables,
      )
      if (res?.success && res.data) setPreflight(res.data as PreflightTableInfo)
    } catch {
      /* ignore — preflight is best-effort */
    }
  }, [sqlSessionId])

  const scanFile = useCallback(async (selected: string) => {
    const name = selected.split(/[/\\]/).pop() || selected
    setFilePath(selected)
    setFileName(name)
    setScanResult(null)
    setScanError(null)
    setDangerAcknowledged(false)
    setPreflight(null)
    setScanning(true)
    try {
      const scanRes = await (window as any).novadeck.sql.preScanSQL(selected)
      if (scanRes.success) {
        const data = scanRes.data as PreScanResult
        setScanResult(data)
        setPhase('ready')
        void runPreflight(data)
      } else {
        setScanError(scanRes.error || 'Failed to scan file')
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err))
    } finally {
      setScanning(false)
    }
  }, [runPreflight])

  useEffect(() => {
    if (open && initialFilePath && !filePath) {
      void scanFile(initialFilePath)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFilePath])

  // ── File selection ──

  const handleChooseFile = useCallback(async () => {
    try {
      const result = await (window as any).novadeck.dialog.openFile({
        title: 'Choose SQL File',
        filters: [{ name: 'SQL Files', extensions: ['sql', 'gz'] }],
      })

      if (result.canceled || !result.filePaths?.length) return

      const selected = result.filePaths[0] as string
      await scanFile(selected)
    } catch (err) {
      console.warn('File dialog error:', err)
    }
  }, [scanFile])

  // ── Import ──

  const handleImport = useCallback(async () => {
    if (!filePath || !scanResult) return

    setImportErrors([])
    setProgress(null)
    operationIdRef.current = null
    // Set phase first — this triggers the progress listener registration
    setPhase('importing')

    try {
      const result = await (window as any).novadeck.sql.importSQL(sqlSessionId, filePath, {
        useTransaction: runMode === 'strict-abort' && useTransaction,
        onError: runMode === 'strict-abort' ? 'abort' : 'skip',
        runMode,
        dryRun,
      })

      if (result.success && result.operationId) {
        operationIdRef.current = result.operationId
        setOperationId(result.operationId)
      } else {
        setImportErrors([result.error || 'Import failed to start'])
        setPhase('complete')
      }
    } catch (err) {
      setImportErrors([err instanceof Error ? err.message : String(err)])
      setPhase('complete')
    }
  }, [filePath, scanResult, sqlSessionId, useTransaction, runMode, dryRun])

  // ── Cancel ──

  const handleCancel = useCallback(async () => {
    if (!operationId) return
    try {
      await (window as any).novadeck.sql.cancelTransfer(operationId)
    } catch {
      // Best effort
    }
  }, [operationId])

  // ── Computed values ──

  const progressPercentage = progress?.percentage ?? 0
  const processedRows = progress?.processedRows ?? 0
  const totalRows = progress?.totalRows ?? scanResult?.statementCount ?? 0
  const currentMessage = progress?.message ?? ''
  const isCompleted = progress?.status === 'completed'
  const isCancelled = progress?.status === 'cancelled'
  const isFailed = progress?.status === 'failed'

  // Don't allow closing via backdrop/escape while importing
  const preventClose = phase === 'importing'

  return (
    <Modal
      open={open}
      onClose={preventClose ? () => {} : onClose}
      title="Import SQL"
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
              You are importing into a PRODUCTION database. Proceed with extreme caution.
            </p>
          </div>
        )}

        {/* ── Phase: Select / Ready ── */}
        {(phase === 'select' || phase === 'ready') && (
          <>
            {/* Resumable imports banner */}
            {checkpoints.length > 0 && (
              <div className="rounded-md bg-nd-accent/10 border border-nd-accent/30 px-3 py-2.5 space-y-2">
                <div className="flex items-start gap-2">
                  <RotateCcw size={14} className="text-nd-accent mt-0.5 shrink-0" />
                  <p className="text-xs font-medium text-nd-accent">
                    {checkpoints.length === 1 ? 'Resumable import detected' : `${checkpoints.length} resumable imports detected`}
                  </p>
                </div>
                <div className="space-y-1.5">
                  {checkpoints.map((cp) => (
                    <div
                      key={cp.operationId}
                      className="flex items-center gap-2 rounded-md bg-nd-surface border border-nd-border px-2.5 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-nd-text-primary font-medium truncate" title={cp.filePath}>
                          {cp.label}
                        </p>
                        <p className="text-[10px] text-nd-text-muted">
                          Stopped at stmt {cp.stmtIndex.toLocaleString()} · {formatFileSize(cp.processedBytes)} / {formatFileSize(cp.totalBytes)} ·{' '}
                          {new Date(cp.updatedAt).toLocaleString()}
                        </p>
                      </div>
                      <Button variant="primary" size="sm" onClick={() => handleResume(cp)}>
                        <RotateCcw size={11} />
                        Resume
                      </Button>
                      <button
                        type="button"
                        onClick={() => handleDiscardCheckpoint(cp)}
                        className="rounded-md p-1 text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface-hover transition-colors"
                        title="Discard checkpoint"
                      >
                        <XIcon size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* File selector */}
            <div>
              <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
                SQL File
              </label>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={handleChooseFile}>
                  <FileText size={13} />
                  Choose SQL File
                </Button>
                {scanning && <Loader2 size={14} className="animate-spin text-nd-text-muted" />}
              </div>

              {/* File info */}
              {fileName && scanResult && (
                <div className="mt-2 rounded-md bg-nd-surface border border-nd-border px-3 py-2 text-xs text-nd-text-secondary space-y-0.5">
                  <p>
                    <span className="text-nd-text-primary font-medium">{fileName}</span>
                  </p>
                  <p>{formatFileSize(scanResult.fileSize)}</p>
                  {filePath && (
                    <p className="text-nd-text-muted truncate" title={filePath}>
                      {filePath}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Scan error */}
            {scanError && (
              <p className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2">
                {scanError}
              </p>
            )}

            {/* Pre-scan results */}
            {scanResult && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
                    Pre-scan Results
                  </label>
                  <div className="rounded-md bg-nd-surface border border-nd-border px-3 py-2 text-xs text-nd-text-secondary space-y-0.5">
                    <p>
                      ~{scanResult.statementCount.toLocaleString()} statements found
                      {typeof scanResult.insertCount === 'number' && scanResult.insertCount > 0 && (
                        <span className="text-nd-text-muted"> · {scanResult.insertCount.toLocaleString()} INSERTs</span>
                      )}
                      {typeof scanResult.createTableCount === 'number' && scanResult.createTableCount > 0 && (
                        <span className="text-nd-text-muted"> · {scanResult.createTableCount} CREATE TABLE</span>
                      )}
                      {typeof scanResult.dropTableCount === 'number' && scanResult.dropTableCount > 0 && (
                        <span className="text-nd-text-muted"> · {scanResult.dropTableCount} DROP TABLE</span>
                      )}
                    </p>
                    {scanResult.referencedTables && scanResult.referencedTables.length > 0 && (
                      <p className="text-nd-text-muted">
                        {scanResult.referencedTables.length} distinct table{scanResult.referencedTables.length === 1 ? '' : 's'} referenced
                      </p>
                    )}
                    {scanResult.charsets && scanResult.charsets.length > 0 && (
                      <p className="text-nd-text-muted">
                        Charset{scanResult.charsets.length === 1 ? '' : 's'}: {scanResult.charsets.join(', ')}
                      </p>
                    )}
                  </div>
                </div>

                {/* Preflight: target schema comparison */}
                {preflight && (preflight.present.length > 0 || preflight.missing.length > 0) && (
                  <div>
                    <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
                      Target schema check
                    </label>
                    <div className="rounded-md bg-nd-surface border border-nd-border px-3 py-2 text-[11px] space-y-0.5">
                      <p className="text-nd-text-primary">
                        <span className="text-emerald-400 font-medium">{preflight.present.length}</span>
                        <span className="text-nd-text-muted"> already present</span>
                        {'  ·  '}
                        <span className={preflight.missing.length > 0 ? 'text-amber-400 font-medium' : 'text-nd-text-primary'}>
                          {preflight.missing.length}
                        </span>
                        <span className="text-nd-text-muted"> missing</span>
                      </p>
                      {preflight.missing.length > 0 && (
                        <p className="text-nd-text-muted break-all">
                          <span className="text-amber-400/80">Missing: </span>
                          {preflight.missing.slice(0, 8).join(', ')}
                          {preflight.missing.length > 8 && <span> … (+{preflight.missing.length - 8} more)</span>}
                        </p>
                      )}
                      <p className="text-[10px] text-nd-text-muted pt-0.5">
                        Missing tables will be created by the import if it contains CREATE TABLE statements,
                        or produce &ldquo;unknown table&rdquo; errors that healing can resolve.
                      </p>
                    </div>
                  </div>
                )}

                {/* Dangerous statements warning */}
                {hasDangerousStatements && (
                  <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-amber-400">
                          This file contains {scanResult.dangerousStatements.length} potentially
                          dangerous statement {scanResult.dangerousStatements.length === 1 ? 'type' : 'types'}
                        </p>
                        <ul className="text-xs text-amber-300/80 space-y-0.5 list-disc list-inside">
                          {scanResult.dangerousStatements.map((stmt) => (
                            <li key={stmt}>{stmt}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer pt-1">
                      <input
                        type="checkbox"
                        checked={dangerAcknowledged}
                        onChange={(e) => setDangerAcknowledged(e.target.checked)}
                        className="rounded accent-nd-accent"
                      />
                      I understand the risks and want to proceed
                    </label>
                  </div>
                )}

                {/* Options */}
                <RunModeSelector value={runMode} onChange={setRunMode} />

                {runMode === 'strict-abort' && (
                  <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useTransaction}
                      onChange={(e) => setUseTransaction(e.target.checked)}
                      className="rounded accent-nd-accent"
                    />
                    Wrap in a single transaction (roll back on first error)
                  </label>
                )}

                <label className="flex items-start gap-2 text-xs text-nd-text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dryRun}
                    onChange={(e) => setDryRun(e.target.checked)}
                    className="rounded accent-nd-accent mt-0.5"
                  />
                  <span>
                    <span className="block">Dry run — parse only, never touches the server</span>
                    <span className="block text-[10px] text-nd-text-muted mt-0.5">
                      Streams and parses the file without sending any statement. Reports a breakdown of what the import would do (CREATE / INSERT / ALTER / etc). Safe on any dump — no transaction trickery, no implicit commits to worry about.
                    </span>
                  </span>
                </label>

                <div>
                  <span className="block text-xs text-nd-text-muted mb-1">Target database</span>
                  <input
                    type="text"
                    value={currentDatabase}
                    readOnly
                    className="w-full px-2.5 py-1.5 rounded-md bg-nd-surface border border-nd-border text-xs text-nd-text-primary font-mono"
                  />
                </div>
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
                onClick={handleImport}
                disabled={!canImport}
              >
                <Upload size={13} />
                Import
              </Button>
            </div>
          </>
        )}

        {/* ── Phase: Importing ── */}
        {phase === 'importing' && (
          <div className="flex flex-col gap-3">
            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-nd-text-secondary">
                  Executing statement {processedRows.toLocaleString()} of ~{totalRows.toLocaleString()}
                </span>
                <span className="text-xs text-nd-text-muted">
                  {progressPercentage >= 0 ? `${Math.round(progressPercentage)}%` : '...'}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-nd-surface overflow-hidden">
                <div
                  className="h-full rounded-full bg-nd-accent transition-all duration-300"
                  style={{ width: `${Math.max(0, Math.min(100, progressPercentage))}%` }}
                />
              </div>
            </div>

            {/* Status message */}
            {currentMessage && (
              <div className="rounded-md bg-nd-surface border border-nd-border px-3 py-2">
                <p className="text-[11px] text-nd-text-secondary truncate">
                  {currentMessage.length > 140 ? currentMessage.slice(0, 140) + '…' : currentMessage}
                </p>
              </div>
            )}

            {/* Current statement preview (monospace, separate from status) */}
            {progress?.currentStatement && (
              <div className="rounded-md bg-black/20 border border-nd-border px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-nd-text-muted mb-1">Currently executing</p>
                <p className="text-[11px] font-mono text-nd-text-primary break-all">
                  {progress.currentStatement}
                </p>
              </div>
            )}

            {/* Elapsed + errors */}
            <div className="flex items-center justify-between text-xs text-nd-text-muted">
              <span className="flex items-center gap-1">
                <Clock size={12} />
                {formatElapsed(elapsed)}
              </span>
              {importErrors.length > 0 && (
                <button
                  onClick={() => setErrorsExpanded((v) => !v)}
                  className="flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors"
                >
                  {importErrors.length} error{importErrors.length !== 1 ? 's' : ''}
                  <ChevronDown
                    size={12}
                    className={cn('transition-transform', errorsExpanded && 'rotate-180')}
                  />
                </button>
              )}
            </div>

            {/* Live error list (visible during import) */}
            {importErrors.length > 0 && errorsExpanded && (
              <div
                ref={errorListRef}
                className="max-h-32 overflow-y-auto rounded-md bg-red-500/5 border border-red-500/20 px-3 py-2 space-y-1"
              >
                {importErrors.map((err, i) => (
                  <p key={i} className="text-[11px] font-mono text-red-400 break-all">
                    {err}
                  </p>
                ))}
              </div>
            )}

            {/* Cancel */}
            <div className="flex justify-end pt-1">
              <Button variant="danger" size="sm" onClick={handleCancel}>
                Cancel Import
              </Button>
            </div>
          </div>
        )}

        {/* ── Phase: Complete ── */}
        {phase === 'complete' && (
          <div className="flex flex-col gap-3">
            {/* Status icon */}
            <div className="flex items-center gap-2">
              {isCompleted && importErrors.length === 0 && (
                <>
                  <CheckCircle size={16} className="text-green-400" />
                  <span className="text-sm font-medium text-green-400">Import completed</span>
                </>
              )}
              {isCompleted && importErrors.length > 0 && (
                <>
                  <AlertTriangle size={16} className="text-amber-400" />
                  <span className="text-sm font-medium text-amber-400">
                    Import completed with errors
                  </span>
                </>
              )}
              {isFailed && (
                <>
                  <XCircle size={16} className="text-red-400" />
                  <span className="text-sm font-medium text-red-400">Import failed</span>
                </>
              )}
              {isCancelled && (
                <>
                  <XCircle size={16} className="text-nd-text-muted" />
                  <span className="text-sm font-medium text-nd-text-muted">Import cancelled</span>
                </>
              )}
            </div>

            {/* Summary */}
            <div className="rounded-md bg-nd-surface border border-nd-border px-3 py-2.5 space-y-1 text-xs text-nd-text-secondary">
              <p>
                Executed:{' '}
                <span className="text-nd-text-primary font-medium">
                  {(progress?.stats?.executed ?? processedRows).toLocaleString()}
                </span>
              </p>
              {progress?.stats && (
                <>
                  <p>
                    Healed:{' '}
                    <span className="text-emerald-400 font-medium">
                      {progress.stats.healed.toLocaleString()}
                    </span>
                  </p>
                  <p>
                    Skipped:{' '}
                    <span className={cn('font-medium', progress.stats.skipped > 0 ? 'text-amber-400' : 'text-nd-text-primary')}>
                      {progress.stats.skipped.toLocaleString()}
                    </span>
                  </p>
                  <p>
                    Quarantined:{' '}
                    <span className={cn('font-medium', progress.stats.quarantined > 0 ? 'text-amber-400' : 'text-nd-text-primary')}>
                      {progress.stats.quarantined.toLocaleString()}
                    </span>
                  </p>
                </>
              )}
              {progress?.quarantinePath && (
                <p className="pt-1 border-t border-nd-border mt-1.5 text-[11px]">
                  <span className="text-nd-text-muted">Quarantine file: </span>
                  <span className="text-nd-text-primary font-mono break-all">{progress.quarantinePath}</span>
                </p>
              )}
              <p>
                Time:{' '}
                <span className="text-nd-text-primary font-medium">{formatElapsed(elapsed)}</span>
              </p>
            </div>

            {/* Error list */}
            {importErrors.length > 0 && (
              <div>
                <button
                  onClick={() => setErrorsExpanded((v) => !v)}
                  className="flex items-center gap-1 text-xs text-nd-text-muted hover:text-nd-text-secondary transition-colors"
                >
                  {errorsExpanded ? 'Hide' : 'Show'} errors ({importErrors.length})
                  <ChevronDown
                    size={12}
                    className={cn('transition-transform', errorsExpanded && 'rotate-180')}
                  />
                </button>
                {errorsExpanded && (
                  <div
                    ref={errorListRef}
                    className="mt-1.5 max-h-32 overflow-y-auto rounded-md bg-red-500/5 border border-red-500/20 px-3 py-2 space-y-1"
                  >
                    {importErrors.map((err, i) => (
                      <p key={i} className="text-[11px] font-mono text-red-400 break-all">
                        {err}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Close + quarantine re-import + report */}
            <div className="flex justify-end gap-2 pt-1 flex-wrap">
              <Button variant="ghost" size="sm" onClick={handleDownloadReport}>
                <FileText size={13} />
                Download report
              </Button>
              {progress?.quarantinePath && onOpenQuarantine && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const path = progress.quarantinePath!
                    onClose()
                    // Give the close animation a moment before reopening.
                    setTimeout(() => onOpenQuarantine(path), 100)
                  }}
                >
                  <FileText size={13} />
                  Re-run quarantine
                </Button>
              )}
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

export default ImportSQLDialog
