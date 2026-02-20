import React, { useState, useCallback } from 'react'
import { Download, FileText, FileJson, Database } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { exportToCSV, exportToJSON, exportToSQL } from '@/utils/sqlExport'
import type { CSVOptions, JSONOptions, SQLOptions } from '@/utils/sqlExport'
import type { QueryResult, DatabaseType } from '@/types/sql'

// ── Props ──

interface ExportDialogProps {
  result: QueryResult
  table?: string
  dbType: DatabaseType
  onClose: () => void
}

type ExportFormat = 'csv' | 'json' | 'sql'

interface FormatMeta {
  label: string
  icon: React.ReactNode
  extensions: string[]
}

const FORMAT_META: Record<ExportFormat, FormatMeta> = {
  csv: { label: 'CSV', icon: <FileText size={14} />, extensions: ['csv'] },
  json: { label: 'JSON', icon: <FileJson size={14} />, extensions: ['json'] },
  sql: { label: 'SQL INSERT', icon: <Database size={14} />, extensions: ['sql'] },
}

// ── Component ──

export function ExportDialog({ result, table, dbType, onClose }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [includeHeaders, setIncludeHeaders] = useState(true)
  const [prettyPrint, setPrettyPrint] = useState(true)
  const [batchInserts, setBatchInserts] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tableName = table || 'exported_data'

  const handleExport = useCallback(async () => {
    setIsExporting(true)
    setError(null)

    try {
      // Generate content
      let content: string
      const meta = FORMAT_META[format]

      switch (format) {
        case 'csv': {
          const opts: CSVOptions = { includeHeaders, delimiter: ',' }
          content = exportToCSV(result, opts)
          break
        }
        case 'json': {
          const opts: JSONOptions = { prettyPrint }
          content = exportToJSON(result, opts)
          break
        }
        case 'sql': {
          const opts: SQLOptions = {
            batchSize: batchInserts ? 100 : 1,
            includeCreate: false,
          }
          content = exportToSQL(result, tableName, dbType, opts)
          break
        }
      }

      // File save dialog
      const defaultFilename = `${tableName}.${meta.extensions[0]}`
      const saveResult = await (window as any).novadeck.dialog.saveFile({
        title: 'Export Data',
        defaultPath: defaultFilename,
        filters: [{ name: meta.label, extensions: meta.extensions }],
      })

      if (saveResult.canceled || !saveResult.filePath) {
        setIsExporting(false)
        return
      }

      // Write file
      await (window as any).novadeck.fs.writeFile(saveResult.filePath, content)

      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsExporting(false)
    }
  }, [format, result, includeHeaders, prettyPrint, batchInserts, tableName, dbType, onClose])

  return (
    <Modal open onClose={onClose} title="Export Data" maxWidth="max-w-sm">
      <div className="flex flex-col gap-4">
        {/* Row count summary */}
        <p className="text-xs text-nd-text-secondary">
          {result.rowCount.toLocaleString()} {result.rowCount === 1 ? 'row' : 'rows'},{' '}
          {result.fields.length} columns
        </p>

        {/* Format selector */}
        <div>
          <label className="block text-xs font-medium text-nd-text-secondary mb-1.5">
            Format
          </label>
          <div className="flex gap-1.5">
            {(Object.keys(FORMAT_META) as ExportFormat[]).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border',
                  format === f
                    ? 'bg-nd-accent/10 border-nd-accent text-nd-accent'
                    : 'border-nd-border text-nd-text-secondary hover:bg-nd-surface hover:text-nd-text-primary'
                )}
              >
                {FORMAT_META[f].icon}
                {FORMAT_META[f].label}
              </button>
            ))}
          </div>
        </div>

        {/* Format-specific options */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-nd-text-secondary">Options</span>

          {/* CSV options */}
          {format === 'csv' && (
            <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={includeHeaders}
                onChange={(e) => setIncludeHeaders(e.target.checked)}
                className="rounded accent-nd-accent"
              />
              Include column headers
            </label>
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

          {/* SQL options */}
          {format === 'sql' && (
            <>
              <label className="flex items-center gap-2 text-xs text-nd-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={batchInserts}
                  onChange={(e) => setBatchInserts(e.target.checked)}
                  className="rounded accent-nd-accent"
                />
                Batch inserts (100 rows per statement)
              </label>
              <div className="mt-1">
                <label className="block text-xs text-nd-text-muted mb-1">Table name</label>
                <input
                  type="text"
                  value={tableName}
                  readOnly
                  className="w-full px-2.5 py-1.5 rounded-md bg-nd-surface border border-nd-border text-xs text-nd-text-primary font-mono"
                />
              </div>
            </>
          )}
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2">{error}</p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleExport}
            disabled={isExporting}
          >
            <Download size={13} />
            {isExporting ? 'Exporting...' : 'Export'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default ExportDialog
