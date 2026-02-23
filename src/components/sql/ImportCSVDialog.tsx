import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  ArrowRight,
  ChevronDown,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { formatFileSize } from '@/utils/fileSize'
import type { DatabaseType, SchemaTable, SchemaColumn, TransferProgress } from '@/types/sql'

// ── Types ──

interface ImportCSVDialogProps {
  open: boolean
  onClose: () => void
  sqlSessionId: string
  connectionId: string
  dbType: DatabaseType
  currentDatabase: string
  /** Available tables for target selection */
  tables: SchemaTable[]
  /** Pre-selected target table (from context menu) */
  preSelectedTable?: string | null
  isProduction?: boolean
  /** Callback to fetch column info for a table */
  onFetchColumns?: (table: string) => Promise<SchemaColumn[]>
}

interface CSVPreviewResult {
  headers: string[]
  sampleRows: string[][]
  totalLines: number
  detectedDelimiter: ',' | '\t' | ';' | '|'
  fileSize: number
}

interface ColumnMapping {
  /** CSV column index → DB column name, or null for "skip" */
  [csvIndex: number]: string | null
}

type ImportPhase = 'select' | 'mapping' | 'importing' | 'complete'
type CSVDelimiter = ',' | '\t' | ';' | '|'

const DELIMITER_OPTIONS: { value: CSVDelimiter; label: string }[] = [
  { value: ',', label: 'Comma' },
  { value: '\t', label: 'Tab' },
  { value: ';', label: 'Semicolon' },
  { value: '|', label: 'Pipe' },
]

// ── Helpers ──

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}m ${s}s`
}

/** Case-insensitive column name matching with underscore tolerance */
function autoMapColumns(
  csvHeaders: string[],
  dbColumns: SchemaColumn[]
): ColumnMapping {
  const mapping: ColumnMapping = {}
  const usedDbCols = new Set<string>()

  for (let i = 0; i < csvHeaders.length; i++) {
    const csvName = csvHeaders[i].toLowerCase().replace(/[\s-]/g, '_').trim()

    // Exact match (case-insensitive)
    const exact = dbColumns.find(
      (c) => c.name.toLowerCase() === csvName && !usedDbCols.has(c.name)
    )
    if (exact) {
      mapping[i] = exact.name
      usedDbCols.add(exact.name)
      continue
    }

    // Underscore-tolerant match (remove all underscores for comparison)
    const stripped = csvName.replace(/_/g, '')
    const fuzzy = dbColumns.find(
      (c) =>
        c.name.toLowerCase().replace(/_/g, '') === stripped &&
        !usedDbCols.has(c.name)
    )
    if (fuzzy) {
      mapping[i] = fuzzy.name
      usedDbCols.add(fuzzy.name)
      continue
    }

    // No match → skip
    mapping[i] = null
  }

  return mapping
}

// ── Component ──

export function ImportCSVDialog({
  open,
  onClose,
  sqlSessionId,
  connectionId,
  dbType,
  currentDatabase,
  tables,
  preSelectedTable,
  isProduction,
  onFetchColumns,
}: ImportCSVDialogProps) {
  // File selection
  const [filePath, setFilePath] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  // CSV preview
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState<CSVPreviewResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // Options
  const [delimiter, setDelimiter] = useState<CSVDelimiter>(',')
  const [hasHeaders, setHasHeaders] = useState(true)
  const [targetTable, setTargetTable] = useState<string>(preSelectedTable || '')
  const [createTable, setCreateTable] = useState(false)
  const [newTableName, setNewTableName] = useState('')
  const [truncateBefore, setTruncateBefore] = useState(false)
  const [onError, setOnError] = useState<'abort' | 'skip'>('abort')
  const [batchSize, setBatchSize] = useState(100)

  // Column mapping
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [dbColumns, setDbColumns] = useState<SchemaColumn[]>([])
  const [loadingColumns, setLoadingColumns] = useState(false)

  // Import state
  const [phase, setPhase] = useState<ImportPhase>('select')
  const [operationId, setOperationId] = useState<string | null>(null)
  const [progress, setProgress] = useState<TransferProgress | null>(null)
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [errorsExpanded, setErrorsExpanded] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const startTimeRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // CSV column names (headers or generated)
  const csvColumnNames = useMemo(() => {
    if (!preview) return []
    if (hasHeaders && preview.headers.length > 0) return preview.headers
    // No headers — generate column names from first sample row
    if (preview.sampleRows.length > 0) {
      return preview.sampleRows[0].map((_, i) => `Column ${i + 1}`)
    }
    return []
  }, [preview, hasHeaders])

  // Data rows for preview — when hasHeaders is false, the backend's "headers" row is actually data
  const previewDataRows = useMemo(() => {
    if (!preview) return []
    if (!hasHeaders && preview.headers.length > 0) {
      return [preview.headers, ...preview.sampleRows]
    }
    return preview.sampleRows
  }, [preview, hasHeaders])

  // Effective table name for import
  const effectiveTable = createTable ? newTableName : targetTable

  // Mapped column count
  const mappedCount = Object.values(mapping).filter((v) => v !== null).length
  const totalCsvColumns = csvColumnNames.length

  // Can proceed to import
  const canImport =
    phase === 'mapping' &&
    effectiveTable.trim() !== '' &&
    mappedCount > 0

  // ── Reset on close/open ──

  useEffect(() => {
    if (!open) {
      setFilePath(null)
      setFileName(null)
      setPreviewing(false)
      setPreview(null)
      setPreviewError(null)
      setDelimiter(',')
      setHasHeaders(true)
      setTargetTable(preSelectedTable || '')
      setCreateTable(false)
      setNewTableName('')
      setTruncateBefore(false)
      setOnError('abort')
      setBatchSize(100)
      setMapping({})
      setDbColumns([])
      setLoadingColumns(false)
      setPhase('select')
      setOperationId(null)
      setProgress(null)
      setImportErrors([])
      setErrorsExpanded(false)
      setElapsed(0)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [open, preSelectedTable])

  // ── Pre-select table from prop ──

  useEffect(() => {
    if (preSelectedTable) {
      setTargetTable(preSelectedTable)
      setCreateTable(false)
    }
  }, [preSelectedTable])

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

  useEffect(() => {
    if (!operationId) return

    const unsub = (window as any).novadeck.sql.onTransferProgress(
      (sessionId: string, p: TransferProgress) => {
        if (sessionId !== sqlSessionId) return
        if (p.operationId !== operationId) return

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
  }, [operationId, sqlSessionId])

  // ── Load columns when target table changes ──

  useEffect(() => {
    if (!targetTable || createTable || !onFetchColumns) {
      setDbColumns([])
      return
    }

    let cancelled = false
    setLoadingColumns(true)

    onFetchColumns(targetTable)
      .then((cols) => {
        if (!cancelled) {
          setDbColumns(cols)
        }
      })
      .catch(() => {
        if (!cancelled) setDbColumns([])
      })
      .finally(() => {
        if (!cancelled) setLoadingColumns(false)
      })

    return () => {
      cancelled = true
    }
  }, [targetTable, createTable, onFetchColumns])

  // ── Auto-map columns when DB columns or CSV headers change ──

  useEffect(() => {
    if (csvColumnNames.length > 0 && dbColumns.length > 0 && !createTable) {
      setMapping(autoMapColumns(csvColumnNames, dbColumns))
    }
  }, [csvColumnNames, dbColumns, createTable])

  // ── File selection ──

  const handleChooseFile = useCallback(async () => {
    try {
      const result = await (window as any).novadeck.dialog.openFile({
        title: 'Choose CSV File',
        filters: [
          { name: 'CSV Files', extensions: ['csv', 'tsv', 'txt'] },
        ],
      })

      if (result.canceled || !result.filePaths?.length) return

      const selected = result.filePaths[0] as string
      const name = selected.split(/[/\\]/).pop() || selected

      setFilePath(selected)
      setFileName(name)
      setPreview(null)
      setPreviewError(null)
      setMapping({})

      // Auto-trigger preview
      setPreviewing(true)
      try {
        const res = await (window as any).novadeck.sql.previewCSV(selected)
        if (res.success) {
          const data = res.data as CSVPreviewResult
          setPreview(data)
          setDelimiter(data.detectedDelimiter)
          setPhase('mapping')
        } else {
          setPreviewError(res.error || 'Failed to preview file')
        }
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : String(err))
      } finally {
        setPreviewing(false)
      }
    } catch (err) {
      console.warn('File dialog error:', err)
    }
  }, [])

  // ── Import ──

  const handleImport = useCallback(async () => {
    if (!filePath || !effectiveTable) return

    setPhase('importing')
    setImportErrors([])
    setProgress(null)

    // Build column mapping: CSV index → DB column name (skip nulls)
    const columnMap: Record<number, string> = {}
    for (const [idx, col] of Object.entries(mapping)) {
      if (col !== null) {
        columnMap[Number(idx)] = col
      }
    }

    try {
      const result = await (window as any).novadeck.sql.importCSV(sqlSessionId, filePath, {
        table: effectiveTable,
        delimiter,
        hasHeaders,
        columnMapping: Object.keys(columnMap).length > 0 ? columnMap : undefined,
        createTable,
        truncateBefore,
        batchSize,
        onError,
        schema: dbType === 'postgres' ? 'public' : undefined,
        totalRows: preview?.totalLines ?? 0,
      })

      if (result.success && result.operationId) {
        setOperationId(result.operationId)
      } else {
        setImportErrors([result.error || 'Import failed to start'])
        setPhase('complete')
      }
    } catch (err) {
      setImportErrors([err instanceof Error ? err.message : String(err)])
      setPhase('complete')
    }
  }, [
    filePath,
    effectiveTable,
    mapping,
    sqlSessionId,
    delimiter,
    hasHeaders,
    createTable,
    truncateBefore,
    batchSize,
    onError,
    dbType,
    preview,
  ])

  // ── Cancel ──

  const handleCancel = useCallback(async () => {
    if (!operationId) return
    try {
      await (window as any).novadeck.sql.cancelTransfer(operationId)
    } catch {
      // Best effort
    }
  }, [operationId])

  // ── Mapping actions ──

  const handleMapColumn = useCallback(
    (csvIndex: number, dbColumn: string | null) => {
      setMapping((prev) => ({ ...prev, [csvIndex]: dbColumn }))
    },
    []
  )

  const handleAutoMap = useCallback(() => {
    if (csvColumnNames.length > 0 && dbColumns.length > 0) {
      setMapping(autoMapColumns(csvColumnNames, dbColumns))
    }
  }, [csvColumnNames, dbColumns])

  const handleClearMapping = useCallback(() => {
    const cleared: ColumnMapping = {}
    csvColumnNames.forEach((_, i) => {
      cleared[i] = null
    })
    setMapping(cleared)
  }, [csvColumnNames])

  // ── Computed values ──

  const progressPercentage = progress?.percentage ?? 0
  const processedRows = progress?.processedRows ?? 0
  const totalRows = progress?.totalRows ?? preview?.totalLines ?? 0
  const currentMessage = progress?.message ?? ''
  const isCompleted = progress?.status === 'completed'
  const isCancelled = progress?.status === 'cancelled'
  const isFailed = progress?.status === 'failed'

  // Don't allow closing while importing
  const preventClose = phase === 'importing'

  return (
    <Modal
      open={open}
      onClose={preventClose ? () => {} : onClose}
      title="Import CSV"
      maxWidth="max-w-3xl"
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

        {/* ── Phase: Select ── */}
        {phase === 'select' && (
          <>
            <div>
              <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
                CSV File
              </label>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={handleChooseFile}>
                  <FileSpreadsheet size={13} />
                  Choose CSV File
                </Button>
                {previewing && <Loader2 size={14} className="animate-spin text-nd-text-muted" />}
              </div>
            </div>

            {previewError && (
              <p className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2">
                {previewError}
              </p>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}

        {/* ── Phase: Mapping ── */}
        {phase === 'mapping' && preview && (
          <>
            {/* Top section: file info + options in a 2-column layout */}
            <div className="grid grid-cols-2 gap-4">
              {/* Left: File info + settings */}
              <div className="flex flex-col gap-3">
                {/* File info */}
                <div>
                  <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
                    File
                  </label>
                  <div className="rounded-md bg-nd-surface border border-nd-border px-3 py-2 text-xs text-nd-text-secondary space-y-0.5">
                    <p>
                      <span className="text-nd-text-primary font-medium">{fileName}</span>
                    </p>
                    <p>
                      {formatFileSize(preview.fileSize)} · ~{preview.totalLines.toLocaleString()} rows
                    </p>
                  </div>
                </div>

                {/* Delimiter */}
                <div>
                  <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
                    Delimiter
                  </label>
                  <select
                    value={delimiter}
                    onChange={(e) => setDelimiter(e.target.value as CSVDelimiter)}
                    className="w-full px-2.5 py-1.5 rounded-md bg-nd-surface border border-nd-border text-xs text-nd-text-primary"
                  >
                    {DELIMITER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                        {opt.value === preview.detectedDelimiter ? ' (detected)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Headers checkbox */}
                <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasHeaders}
                    onChange={(e) => setHasHeaders(e.target.checked)}
                    className="rounded accent-nd-accent"
                  />
                  First row is header
                </label>
              </div>

              {/* Right: Target table + options */}
              <div className="flex flex-col gap-3">
                {/* Target table */}
                <div>
                  <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
                    Target Table
                  </label>
                  {!createTable ? (
                    <select
                      value={targetTable}
                      onChange={(e) => setTargetTable(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-md bg-nd-surface border border-nd-border text-xs text-nd-text-primary"
                    >
                      <option value="">Select a table...</option>
                      {tables
                        .filter((t) => t.type === 'table')
                        .map((t) => (
                          <option key={t.name} value={t.name}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={newTableName}
                      onChange={(e) => setNewTableName(e.target.value)}
                      placeholder="new_table_name"
                      className="w-full px-2.5 py-1.5 rounded-md bg-nd-surface border border-nd-border text-xs text-nd-text-primary placeholder:text-nd-text-muted"
                    />
                  )}
                  <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer mt-1.5">
                    <input
                      type="checkbox"
                      checked={createTable}
                      onChange={(e) => {
                        setCreateTable(e.target.checked)
                        if (e.target.checked && !newTableName && fileName) {
                          // Suggest table name from file name
                          const suggested = fileName
                            .replace(/\.[^.]+$/, '')
                            .replace(/[^a-zA-Z0-9_]/g, '_')
                            .replace(/_+/g, '_')
                            .replace(/^_|_$/g, '')
                            .toLowerCase()
                          setNewTableName(suggested)
                        }
                      }}
                      className="rounded accent-nd-accent"
                    />
                    Create new table
                  </label>
                </div>

                {/* Options */}
                <div className="space-y-2">
                  {!createTable && (
                    <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={truncateBefore}
                        onChange={(e) => setTruncateBefore(e.target.checked)}
                        className="rounded accent-nd-accent"
                      />
                      Truncate table before import
                    </label>
                  )}

                  <div>
                    <span className="block text-xs text-nd-text-muted mb-1">On error</span>
                    <div className="flex gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-nd-text-primary cursor-pointer">
                        <input
                          type="radio"
                          name="csvOnError"
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
                          name="csvOnError"
                          value="skip"
                          checked={onError === 'skip'}
                          onChange={() => setOnError('skip')}
                          className="accent-nd-accent"
                        />
                        Skip row
                      </label>
                    </div>
                  </div>

                  <div>
                    <span className="block text-xs text-nd-text-muted mb-1">Batch size</span>
                    <input
                      type="number"
                      value={batchSize}
                      onChange={(e) =>
                        setBatchSize(Math.max(1, Math.min(10000, Number(e.target.value) || 100)))
                      }
                      min={1}
                      max={10000}
                      className="w-24 px-2.5 py-1.5 rounded-md bg-nd-surface border border-nd-border text-xs text-nd-text-primary"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Column Mapping */}
            {(targetTable || createTable) && csvColumnNames.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-nd-text-secondary">
                    Column Mapping
                    <span className="text-nd-text-muted ml-2">
                      {mappedCount} of {totalCsvColumns} mapped
                    </span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    {!createTable && dbColumns.length > 0 && (
                      <button
                        onClick={handleAutoMap}
                        className="text-[11px] text-nd-accent hover:text-nd-accent/80 transition-colors flex items-center gap-1"
                      >
                        <RotateCcw size={11} />
                        Auto Map
                      </button>
                    )}
                    <button
                      onClick={handleClearMapping}
                      className="text-[11px] text-nd-text-muted hover:text-nd-text-secondary transition-colors flex items-center gap-1"
                    >
                      <Trash2 size={11} />
                      Clear
                    </button>
                  </div>
                </div>

                {loadingColumns && (
                  <div className="flex items-center gap-2 text-xs text-nd-text-muted py-2">
                    <Loader2 size={12} className="animate-spin" />
                    Loading table columns...
                  </div>
                )}

                <div className="rounded-md border border-nd-border overflow-hidden max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-nd-surface border-b border-nd-border">
                        <th className="text-left px-3 py-1.5 text-nd-text-muted font-medium w-[30%]">
                          CSV Column
                        </th>
                        <th className="px-2 py-1.5 w-8" />
                        <th className="text-left px-3 py-1.5 text-nd-text-muted font-medium w-[30%]">
                          DB Column
                        </th>
                        <th className="text-left px-3 py-1.5 text-nd-text-muted font-medium">
                          Sample Data
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvColumnNames.map((csvCol, i) => {
                        const mapped = mapping[i]
                        const isSkipped = mapped === null
                        const sampleValues = previewDataRows
                          .slice(0, 3)
                          .map((row) => row[i] ?? '')
                          .filter(Boolean)
                          .join(', ')

                        return (
                          <tr
                            key={i}
                            className={cn(
                              'border-b border-nd-border/50 last:border-b-0',
                              isSkipped && 'opacity-50'
                            )}
                          >
                            <td className="px-3 py-1.5">
                              <span className="font-mono text-nd-text-primary">{csvCol}</span>
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              <ArrowRight size={12} className="text-nd-text-muted" />
                            </td>
                            <td className="px-3 py-1.5">
                              {createTable ? (
                                <span className="font-mono text-nd-text-primary">{csvCol}</span>
                              ) : (
                                <div className="relative">
                                  <select
                                    value={mapped ?? '__skip__'}
                                    onChange={(e) =>
                                      handleMapColumn(
                                        i,
                                        e.target.value === '__skip__' ? null : e.target.value
                                      )
                                    }
                                    className={cn(
                                      'w-full px-2 py-1 rounded bg-nd-surface border border-nd-border text-xs appearance-none pr-6',
                                      isSkipped
                                        ? 'text-nd-text-muted italic'
                                        : 'text-nd-text-primary'
                                    )}
                                  >
                                    <option value="__skip__">(skip)</option>
                                    {dbColumns.map((col) => (
                                      <option key={col.name} value={col.name}>
                                        {col.name} ({col.type})
                                      </option>
                                    ))}
                                  </select>
                                  <ChevronDown
                                    size={10}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-nd-text-muted pointer-events-none"
                                  />
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-1.5">
                              <span className="text-nd-text-muted font-mono text-[11px] truncate block max-w-[180px]">
                                {sampleValues || '—'}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Unmapped column warning */}
                {!createTable && mappedCount < totalCsvColumns && mappedCount > 0 && (
                  <p className="text-[11px] text-amber-400 mt-1.5 flex items-center gap-1">
                    <AlertTriangle size={11} />
                    {totalCsvColumns - mappedCount} column{totalCsvColumns - mappedCount !== 1 ? 's' : ''} will be skipped
                  </p>
                )}

                {!createTable && mappedCount === 0 && dbColumns.length > 0 && (
                  <p className="text-[11px] text-red-400 mt-1.5 flex items-center gap-1">
                    <XCircle size={11} />
                    No columns mapped. Map at least one column to import.
                  </p>
                )}
              </div>
            )}

            {/* Data preview */}
            {previewDataRows.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
                  Preview (first {Math.min(5, previewDataRows.length)} rows)
                </label>
                <div className="rounded-md border border-nd-border overflow-hidden overflow-x-auto max-h-32">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-nd-surface border-b border-nd-border">
                        {csvColumnNames.map((col, i) => (
                          <th
                            key={i}
                            className={cn(
                              'text-left px-2 py-1 text-nd-text-muted font-medium whitespace-nowrap',
                              mapping[i] === null && !createTable && 'opacity-40'
                            )}
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewDataRows.slice(0, 5).map((row, ri) => (
                        <tr key={ri} className="border-b border-nd-border/30 last:border-b-0">
                          {row.map((cell, ci) => (
                            <td
                              key={ci}
                              className={cn(
                                'px-2 py-1 text-nd-text-secondary font-mono whitespace-nowrap max-w-[150px] truncate',
                                mapping[ci] === null && !createTable && 'opacity-40'
                              )}
                            >
                              {cell || <span className="text-nd-text-muted italic">NULL</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Truncate warning */}
            {truncateBefore && (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2">
                <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-400">
                  All existing data in <span className="font-mono font-medium">{effectiveTable}</span> will be deleted before import.
                </p>
              </div>
            )}

            {/* Change file + Actions */}
            <div className="flex items-center justify-between pt-1">
              <Button variant="ghost" size="sm" onClick={handleChooseFile}>
                <FileSpreadsheet size={13} />
                Change File
              </Button>
              <div className="flex items-center gap-2">
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
                  Import {preview ? `~${preview.totalLines.toLocaleString()} rows` : ''}
                </Button>
              </div>
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
                  Importing row {processedRows.toLocaleString()} of ~{totalRows.toLocaleString()}
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

            {/* Current operation */}
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
                Table:{' '}
                <span className="text-nd-text-primary font-medium font-mono">{effectiveTable}</span>
              </p>
              <p>
                Rows imported:{' '}
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
