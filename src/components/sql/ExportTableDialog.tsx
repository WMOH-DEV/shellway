import { useState, useCallback, useEffect, useRef } from 'react'
import { Download, FileText, FileJson, Database } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import type { TransferProgress } from '@/types/sql'

// ── Types ──

interface ExportTableDialogProps {
  open: boolean
  onClose: () => void
  sqlSessionId: string
  connectionId: string
  dbType: 'mysql' | 'postgres'
  currentDatabase: string
  /** Pre-selected table (from context menu). If null, defaults to "All Tables" */
  table?: string | null
  /** Pre-selected tables from multi-select in sidebar */
  selectedTables?: string[] | null
  /** Initial format from context menu action (e.g. "Export as CSV") */
  initialFormat?: ExportFormat | null
  /** Available tables for multi-select */
  tables: { name: string; type: 'table' | 'view' }[]
}

type ExportFormat = 'csv' | 'json' | 'sql'
type ExportScope = 'table' | 'selected' | 'all'
type CSVDelimiter = ',' | '\t' | ';' | '|'

interface FormatMeta {
  label: string
  icon: React.ReactNode
  extensions: string[]
}

const FORMAT_META: Record<ExportFormat, FormatMeta> = {
  csv: { label: 'CSV', icon: <FileText size={14} />, extensions: ['csv'] },
  json: { label: 'JSON', icon: <FileJson size={14} />, extensions: ['json'] },
  sql: { label: 'SQL', icon: <Database size={14} />, extensions: ['sql'] },
}

const DELIMITER_OPTIONS: { value: CSVDelimiter; label: string }[] = [
  { value: ',', label: 'Comma' },
  { value: '\t', label: 'Tab' },
  { value: ';', label: 'Semicolon' },
  { value: '|', label: 'Pipe' },
]

type DialogPhase = 'options' | 'progress' | 'done'

// ── Component ──

export function ExportTableDialog({
  open,
  onClose,
  sqlSessionId,
  connectionId,
  dbType,
  currentDatabase,
  table,
  selectedTables,
  initialFormat,
  tables,
}: ExportTableDialogProps) {
  // Scope — default to 'selected' if multi-select, 'table' if single, 'all' otherwise
  const [scope, setScope] = useState<ExportScope>(
    selectedTables && selectedTables.length > 0 ? 'selected' : table ? 'table' : 'all'
  )

  // Format
  const [format, setFormat] = useState<ExportFormat>('sql')

  // SQL options
  const [includeStructure, setIncludeStructure] = useState(true)
  const [includeData, setIncludeData] = useState(true)
  const [addDropTable, setAddDropTable] = useState(false)
  const [addIfNotExists, setAddIfNotExists] = useState(true)
  const [batchSize, setBatchSize] = useState(100)

  // CSV options
  const [delimiter, setDelimiter] = useState<CSVDelimiter>(',')
  const [includeHeaders, setIncludeHeaders] = useState(true)

  // JSON options
  const [prettyPrint, setPrettyPrint] = useState(true)

  // Export state
  const [phase, setPhase] = useState<DialogPhase>('options')
  const [progress, setProgress] = useState<TransferProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const operationIdRef = useRef<string | null>(null)
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      const newScope = selectedTables && selectedTables.length > 0 ? 'selected' : table ? 'table' : 'all'
      setScope(newScope)
      // Use initial format from context menu, or default to SQL
      // For 'all' scope, force SQL (CSV/JSON not supported for full DB export)
      const resolvedFormat = newScope === 'all' ? 'sql' : (initialFormat ?? 'sql')
      setFormat(resolvedFormat)
      setIncludeStructure(true)
      setIncludeData(true)
      setAddDropTable(false)
      setAddIfNotExists(true)
      setBatchSize(100)
      setDelimiter(',')
      setIncludeHeaders(true)
      setPrettyPrint(true)
      setPhase('options')
      setProgress(null)
      setError(null)
      setResultMessage(null)
      operationIdRef.current = null
    }
    return () => {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current)
        autoCloseTimerRef.current = null
      }
    }
  }, [open, table, selectedTables, initialFormat])

  // Force SQL format when scope is "all" (CSV/JSON not supported for full database export)
  // "selected" scope supports all formats since individual tables are exported
  useEffect(() => {
    if (scope === 'all' && format !== 'sql') {
      setFormat('sql')
    }
  }, [scope, format])

  // Listen for transfer progress
  useEffect(() => {
    if (!open) return

    const unsub = window.novadeck.sql.onTransferProgress(
      (sid: string, rawProgress: unknown) => {
        if (sid !== sqlSessionId) return
        const p = rawProgress as TransferProgress
        if (operationIdRef.current && p.operationId !== operationIdRef.current) return

        setProgress(p)

        if (p.status === 'completed') {
          const rows = p.processedRows ?? 0
          setResultMessage(
            `Exported ${rows.toLocaleString()} rows successfully`
          )
          setPhase('done')
          autoCloseTimerRef.current = setTimeout(onClose, 3000)
        } else if (p.status === 'failed') {
          setError(p.error || 'Export failed')
          setPhase('done')
        } else if (p.status === 'cancelled') {
          setError('Export cancelled')
          setPhase('done')
        }
      }
    )

    return () => { unsub() }
  }, [open, sqlSessionId, onClose])

  const handleExport = useCallback(async () => {
    setError(null)

    // Determine filename
    const baseName =
      scope === 'table' && table
        ? table
        : scope === 'selected' && selectedTables && selectedTables.length > 0
          ? `${currentDatabase}_${selectedTables.length}_tables`
          : `${currentDatabase}_export`
    const ext = FORMAT_META[format].extensions[0]
    const defaultFilename = `${baseName}.${ext}`

    // File save dialog
    const saveResult = await window.novadeck.dialog.saveFile({
      title: 'Export Data',
      defaultPath: defaultFilename,
      filters: [
        { name: FORMAT_META[format].label, extensions: FORMAT_META[format].extensions },
      ],
    })

    if (saveResult.canceled || !saveResult.filePath) return

    // Build export options
    const options: Record<string, unknown> = {
      format,
      includeStructure: format === 'sql' ? includeStructure : false,
      includeData: format === 'sql' ? includeData : true,
    }

    if (scope === 'table' && table) {
      options.scope = 'table'
      options.table = table
    } else if (scope === 'selected' && selectedTables && selectedTables.length > 0) {
      options.scope = 'database'
      options.tables = selectedTables
    } else {
      options.scope = 'database'
      options.tables = tables.map((t) => t.name)
    }

    if (format === 'sql') {
      options.batchSize = batchSize
      options.addDropTable = addDropTable
      options.addIfNotExists = addIfNotExists
    } else if (format === 'csv') {
      options.delimiter = delimiter
      options.includeHeaders = includeHeaders
    } else if (format === 'json') {
      options.prettyPrint = prettyPrint
    }

    setPhase('progress')
    setProgress(null)

    try {
      const result = await window.novadeck.sql.exportData(
        sqlSessionId,
        saveResult.filePath,
        options
      )

      const typed = result as { success: boolean; operationId?: string; error?: string }

      if (!typed.success) {
        setError(typed.error || 'Export failed')
        setPhase('done')
        return
      }

      if (typed.operationId) {
        operationIdRef.current = typed.operationId
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('done')
    }
  }, [
    scope,
    table,
    selectedTables,
    currentDatabase,
    format,
    includeStructure,
    includeData,
    addDropTable,
    addIfNotExists,
    batchSize,
    delimiter,
    includeHeaders,
    prettyPrint,
    tables,
    sqlSessionId,
  ])

  const handleCancel = useCallback(() => {
    if (operationIdRef.current) {
      window.novadeck.sql.cancelTransfer(operationIdRef.current).catch(() => {})
    }
  }, [])

  const handleClose = useCallback(() => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current)
      autoCloseTimerRef.current = null
    }
    onClose()
  }, [onClose])

  const percentage = progress?.percentage ?? 0
  const displayPercentage = percentage < 0 ? 0 : percentage

  return (
    <Modal
      open={open}
      onClose={phase === 'progress' ? () => {} : handleClose}
      title="Export Data"
      maxWidth="max-w-sm"
      closeOnBackdrop={phase !== 'progress'}
      closeOnEscape={phase !== 'progress'}
    >
      <div className="flex flex-col gap-4">
        {/* Options phase */}
        {phase === 'options' && (
          <>
            {/* Scope selector */}
            <div>
              <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
                Scope
              </label>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer">
                  <input
                    type="radio"
                    name="export-scope"
                    checked={scope === 'table'}
                    onChange={() => setScope('table')}
                    disabled={!table}
                    className="accent-nd-accent"
                  />
                  Selected Table
                </label>
                {scope === 'table' && table && (
                  <span className="ml-6 text-xs text-nd-text-muted font-mono">
                    {table}
                  </span>
                )}
                {selectedTables && selectedTables.length > 0 && (
                  <>
                    <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer">
                      <input
                        type="radio"
                        name="export-scope"
                        checked={scope === 'selected'}
                        onChange={() => setScope('selected')}
                        className="accent-nd-accent"
                      />
                      Selected Tables
                      <span className="text-nd-text-muted">
                        ({selectedTables.length})
                      </span>
                    </label>
                    {scope === 'selected' && (
                      <div className="ml-6 flex flex-col gap-0.5 max-h-24 overflow-y-auto">
                        {selectedTables.map((t) => (
                          <span key={t} className="text-xs text-nd-text-muted font-mono">{t}</span>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer">
                  <input
                    type="radio"
                    name="export-scope"
                    checked={scope === 'all'}
                    onChange={() => setScope('all')}
                    className="accent-nd-accent"
                  />
                  All Tables
                  <span className="text-nd-text-muted">
                    ({tables.length})
                  </span>
                </label>
              </div>
            </div>

            {/* Format selector */}
            <div>
              <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
                Format
              </label>
              <div className="flex gap-1.5">
                {(Object.keys(FORMAT_META) as ExportFormat[]).map((f) => {
                  const disabled = scope === 'all' && f !== 'sql' // CSV/JSON only disabled for full-database export
                  return (
                    <button
                      key={f}
                      onClick={() => !disabled && setFormat(f)}
                      disabled={disabled}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border',
                        format === f
                          ? 'bg-nd-accent/10 border-nd-accent text-nd-accent'
                          : 'border-nd-border text-nd-text-secondary hover:bg-nd-surface hover:text-nd-text-primary',
                        disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent hover:text-nd-text-secondary'
                      )}
                    >
                      {FORMAT_META[f].icon}
                      {FORMAT_META[f].label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Format-specific options */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-nd-text-secondary">
                Options
              </span>

              {/* SQL options */}
              {format === 'sql' && (
                <>
                  <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeStructure}
                      onChange={(e) => setIncludeStructure(e.target.checked)}
                      className="rounded accent-nd-accent"
                    />
                    Include structure (CREATE TABLE)
                  </label>
                  <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeData}
                      onChange={(e) => setIncludeData(e.target.checked)}
                      className="rounded accent-nd-accent"
                    />
                    Include data (INSERT statements)
                  </label>
                  <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addDropTable}
                      onChange={(e) => setAddDropTable(e.target.checked)}
                      className="rounded accent-nd-accent"
                    />
                    Add DROP TABLE IF EXISTS
                  </label>
                  <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addIfNotExists}
                      onChange={(e) => setAddIfNotExists(e.target.checked)}
                      className="rounded accent-nd-accent"
                    />
                    Add IF NOT EXISTS
                  </label>
                  <div className="mt-1">
                    <label className="block text-xs text-nd-text-muted mb-1">
                      Batch size (rows per INSERT)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={batchSize}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10)
                        if (!isNaN(v)) setBatchSize(Math.max(1, Math.min(1000, v)))
                      }}
                      className="w-24 px-2.5 py-1.5 rounded-md bg-nd-surface border border-nd-border text-xs text-nd-text-primary font-mono"
                    />
                  </div>
                </>
              )}

              {/* CSV options */}
              {format === 'csv' && (
                <>
                  <div>
                    <label className="block text-xs text-nd-text-muted mb-1">
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
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeHeaders}
                      onChange={(e) => setIncludeHeaders(e.target.checked)}
                      className="rounded accent-nd-accent"
                    />
                    Include column headers
                  </label>
                </>
              )}

              {/* JSON options */}
              {format === 'json' && (
                <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={prettyPrint}
                    onChange={(e) => setPrettyPrint(e.target.checked)}
                    className="rounded accent-nd-accent"
                  />
                  Pretty print
                </label>
              )}
            </div>

            {/* Error (from previous attempt) */}
            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleExport}
                disabled={format === 'sql' && !includeStructure && !includeData}
              >
                <Download size={13} />
                Export
              </Button>
            </div>
          </>
        )}

        {/* Progress phase */}
        {phase === 'progress' && (
          <>
            <div className="flex flex-col gap-3">
              {/* Progress bar */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-nd-text-secondary">
                    {progress?.message || 'Starting export...'}
                  </span>
                  <span className="text-xs font-mono text-nd-text-muted">
                    {percentage >= 0 ? `${displayPercentage}%` : '...'}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-nd-surface overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-300',
                      percentage < 0
                        ? 'bg-nd-accent animate-pulse w-full'
                        : 'bg-nd-accent'
                    )}
                    style={
                      percentage >= 0
                        ? { width: `${displayPercentage}%` }
                        : undefined
                    }
                  />
                </div>
              </div>

              {/* Details */}
              <div className="flex flex-col gap-0.5">
                {progress?.currentTable && (
                  <p className="text-xs text-nd-text-muted">
                    Table:{' '}
                    <span className="font-mono text-nd-text-secondary">
                      {progress.currentTable}
                    </span>
                  </p>
                )}
                {progress?.processedRows != null && (
                  <p className="text-xs text-nd-text-muted">
                    Rows:{' '}
                    <span className="font-mono text-nd-text-secondary">
                      {progress.processedRows.toLocaleString()}
                      {progress.totalRows
                        ? ` / ${progress.totalRows.toLocaleString()}`
                        : ''}
                    </span>
                  </p>
                )}
              </div>
            </div>

            {/* Cancel */}
            <div className="flex items-center justify-end pt-1">
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </>
        )}

        {/* Done phase */}
        {phase === 'done' && (
          <>
            {resultMessage && !error && (
              <p className="text-xs text-green-400 bg-green-500/10 rounded-md px-3 py-2">
                {resultMessage}
              </p>
            )}
            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex items-center justify-end pt-1">
              <Button variant="ghost" size="sm" onClick={handleClose}>
                Close
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

export default ExportTableDialog
