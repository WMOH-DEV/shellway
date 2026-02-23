import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { formatFileSize } from '@/utils/fileSize'
import type { DatabaseType, TransferProgress } from '@/types/sql'

// ── Types ──

interface ImportSQLDialogProps {
  open: boolean
  onClose: () => void
  sqlSessionId: string
  connectionId: string
  dbType: DatabaseType
  currentDatabase: string
  isProduction?: boolean
}

interface PreScanResult {
  statementCount: number
  dangerousStatements: string[]
  fileSize: number
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
  const [onError, setOnError] = useState<'abort' | 'skip'>('abort')

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
      setOnError('abort')
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

  // ── File selection ──

  const handleChooseFile = useCallback(async () => {
    try {
      const result = await (window as any).novadeck.dialog.openFile({
        title: 'Choose SQL File',
        filters: [{ name: 'SQL Files', extensions: ['sql'] }],
      })

      if (result.canceled || !result.filePaths?.length) return

      const selected = result.filePaths[0] as string
      const name = selected.split(/[/\\]/).pop() || selected

      setFilePath(selected)
      setFileName(name)
      setScanResult(null)
      setScanError(null)
      setDangerAcknowledged(false)

      // Auto-trigger pre-scan
      setScanning(true)
      try {
        const scanRes = await (window as any).novadeck.sql.preScanSQL(selected)
        if (scanRes.success) {
          setScanResult(scanRes.data as PreScanResult)
          setPhase('ready')
        } else {
          setScanError(scanRes.error || 'Failed to scan file')
        }
      } catch (err) {
        setScanError(err instanceof Error ? err.message : String(err))
      } finally {
        setScanning(false)
      }
    } catch (err) {
      console.warn('File dialog error:', err)
    }
  }, [])

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
        useTransaction,
        onError,
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
  }, [filePath, scanResult, sqlSessionId, useTransaction, onError])

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
                  <div className="rounded-md bg-nd-surface border border-nd-border px-3 py-2 text-xs text-nd-text-secondary">
                    <p>
                      ~{scanResult.statementCount.toLocaleString()} statements found
                    </p>
                  </div>
                </div>

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
                <div>
                  <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
                    Options
                  </label>
                  <div className="space-y-2.5">
                    <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useTransaction}
                        onChange={(e) => setUseTransaction(e.target.checked)}
                        className="rounded accent-nd-accent"
                      />
                      Execute in single transaction
                    </label>

                    <div>
                      <span className="block text-xs text-nd-text-muted mb-1">On error</span>
                      <div className="flex gap-3">
                        <label className="flex items-center gap-1.5 text-xs text-nd-text-primary cursor-pointer">
                          <input
                            type="radio"
                            name="onError"
                            value="abort"
                            checked={onError === 'abort'}
                            onChange={() => setOnError('abort')}
                            className="accent-nd-accent"
                          />
                          Abort
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-nd-text-primary cursor-pointer">
                          <input
                            type="radio"
                            name="onError"
                            value="skip"
                            checked={onError === 'skip'}
                            onChange={() => setOnError('skip')}
                            className="accent-nd-accent"
                          />
                          Skip and continue
                        </label>
                      </div>
                    </div>

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

            {/* Current statement preview */}
            {currentMessage && (
              <div className="rounded-md bg-nd-surface border border-nd-border px-3 py-2">
                <p className="text-[11px] font-mono text-nd-text-muted truncate">
                  {currentMessage.length > 100
                    ? currentMessage.slice(0, 100) + '...'
                    : currentMessage}
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
                <span className="text-red-400">
                  {importErrors.length} error{importErrors.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

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
                Statements executed:{' '}
                <span className="text-nd-text-primary font-medium">
                  {processedRows.toLocaleString()}
                </span>
              </p>
              <p>
                Errors:{' '}
                <span
                  className={cn(
                    'font-medium',
                    importErrors.length > 0 ? 'text-red-400' : 'text-nd-text-primary'
                  )}
                >
                  {importErrors.length}
                </span>
              </p>
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
                  className="text-xs text-nd-text-muted hover:text-nd-text-secondary transition-colors"
                >
                  {errorsExpanded ? 'Hide' : 'Show'} errors ({importErrors.length})
                </button>
                {errorsExpanded && (
                  <div className="mt-1.5 max-h-32 overflow-y-auto rounded-md bg-red-500/5 border border-red-500/20 px-3 py-2 space-y-1">
                    {importErrors.map((err, i) => (
                      <p key={i} className="text-[11px] font-mono text-red-400 break-all">
                        {err}
                      </p>
                    ))}
                  </div>
                )}
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

export default ImportSQLDialog
