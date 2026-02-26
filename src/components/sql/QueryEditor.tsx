import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react'
import Editor, { loader, type OnMount, type OnChange } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import type * as MonacoEditor from 'monaco-editor'

// Configure Monaco to use locally bundled files instead of CDN
// This is critical for Electron — CDN may be blocked or unavailable
loader.config({ monaco })

// Configure Monaco web workers for Vite bundling
self.MonacoEnvironment = {
  getWorker(_: unknown, _label: string) {
    return new Worker(
      new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
      { type: 'module' }
    )
  },
}
import { Play, PlayCircle, History, Download, Loader2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import { Splitter } from '@/components/ui/Splitter'
import { DataGrid } from '@/components/sql/DataGrid'
import { registerSQLCompletionProvider } from '@/components/sql/sqlAutocomplete'
import { useSQLConnection } from '@/stores/sqlStore'
import type { QueryResult, QueryError, DatabaseType } from '@/types/sql'

// ── Props ──

interface QueryEditorProps {
  connectionId: string
  sqlSessionId: string
  dbType: DatabaseType
}

// ── Shellway dark theme definition ──

function defineShellwayTheme(monaco: typeof MonacoEditor) {
  monaco.editor.defineTheme('shellway-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '38bdf8', fontStyle: 'bold' },
      { token: 'string', foreground: '86efac' },
      { token: 'number', foreground: 'fbbf24' },
      { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
      { token: 'operator', foreground: 'e2e8f0' },
      { token: 'predefined', foreground: 'c084fc' },
    ],
    colors: {
      'editor.background': '#0f1117',
      'editor.foreground': '#e2e8f0',
      'editor.lineHighlightBackground': '#1e293b40',
      'editor.selectionBackground': '#38bdf830',
      'editorCursor.foreground': '#38bdf8',
      'editorGutter.background': '#0f1117',
      'editorLineNumber.foreground': '#475569',
      'editorLineNumber.activeForeground': '#94a3b8',
      'editor.inactiveSelectionBackground': '#38bdf815',
    },
  })
}

// ── Monaco editor options ──

const EDITOR_OPTIONS: MonacoEditor.editor.IStandaloneEditorConstructionOptions = {
  language: 'sql',
  theme: 'shellway-dark',
  minimap: { enabled: false },
  fontSize: 13,
  lineNumbers: 'on',
  tabSize: 2,
  insertSpaces: true,
  wordWrap: 'on',
  scrollBeyondLastLine: false,
  automaticLayout: true,
  suggestOnTriggerCharacters: true,
  quickSuggestions: true,
  padding: { top: 8 },
  renderLineHighlight: 'line',
  matchBrackets: 'always',
  folding: true,
  glyphMargin: false,
}

// ── Debounce helper ──

function useDebouncedCallback<T extends (...args: never[]) => void>(
  fn: T,
  delay: number
): T {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  // Cleanup pending timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return useCallback(
    ((...args: never[]) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => fnRef.current(...args), delay)
    }) as T,
    [delay]
  )
}

// ── Results Header ──

interface ResultsHeaderProps {
  result: QueryResult | null
  error: QueryError | null
  isLoading: boolean
  onExport: () => void
  onHistory: () => void
}

const ResultsHeader = React.memo(function ResultsHeader({
  result,
  error,
  isLoading,
  onExport,
  onHistory,
}: ResultsHeaderProps) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-nd-border bg-nd-bg-secondary shrink-0">
      <div className="flex items-center gap-3 text-xs text-nd-text-secondary">
        {isLoading && (
          <span className="flex items-center gap-1.5 text-nd-text-muted">
            <Loader2 size={12} className="animate-spin" />
            Running...
          </span>
        )}
        {!isLoading && result && !error && (
          <>
            <span className="text-nd-success font-medium">
              {result.rowCount.toLocaleString()} {result.rowCount === 1 ? 'row' : 'rows'}
            </span>
            <span className="text-nd-text-muted">|</span>
            <span>{result.fields.length} columns</span>
            <span className="text-nd-text-muted">|</span>
            <span>{result.executionTimeMs}ms</span>
            {result.affectedRows !== undefined && (
              <>
                <span className="text-nd-text-muted">|</span>
                <span>{result.affectedRows} affected</span>
              </>
            )}
          </>
        )}
        {!isLoading && !result && !error && (
          <span className="text-nd-text-muted">Run a query to see results</span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={onHistory} title="Query History">
          <History size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onExport}
          disabled={!result || result.rowCount === 0}
          title="Export Results"
        >
          <Download size={14} />
        </Button>
      </div>
    </div>
  )
})

// ── Error banner ──

const ErrorBanner = React.memo(function ErrorBanner({ error }: { error: QueryError }) {
  return (
    <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/30 text-xs text-red-400 font-mono whitespace-pre-wrap">
      {error.code && <span className="font-semibold">[{error.code}] </span>}
      {error.message}
      {error.line && (
        <span className="ml-2 text-red-500/60">
          (line {error.line}{error.position ? `, col ${error.position}` : ''})
        </span>
      )}
    </div>
  )
})

// ── Main Component ──

export const QueryEditor = React.memo(function QueryEditor({
  connectionId,
  sqlSessionId,
  dbType,
}: QueryEditorProps) {
  const editorRef = useRef<MonacoEditor.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof MonacoEditor | null>(null)
  const completionDisposableRef = useRef<MonacoEditor.IDisposable | null>(null)

  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<QueryError | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showExport, setShowExport] = useState(false)

  // Race condition protection — prevents stale results from overwriting newer ones
  const queryIdCounterRef = useRef(0)
  const ipcQueryIdRef = useRef<string | null>(null)

  // Store selectors (scoped to this connection)
  const {
    tables,
    columns,
    databases,
    setCurrentQuery,
    setQueryError,
    addRunningQuery,
  } = useSQLConnection(connectionId)

  // Debounced store sync — avoid updating store on every keystroke
  const debouncedSetQuery = useDebouncedCallback(
    (value: string) => setCurrentQuery(value),
    300
  )

  // Schema getter for autocomplete (stable ref to avoid re-registering)
  const getSchema = useCallback(
    () => ({
      tables,
      columns,
      databases: databases.map((d) => d.name),
    }),
    [tables, columns, databases]
  )

  // ── Execute query via IPC (with race condition protection) ──
  const executeQuery = useCallback(
    async (query: string) => {
      const trimmed = query.trim()
      if (!trimmed) return

      // Race protection — increment counter so stale results are discarded.
      // We do NOT send server-side KILL QUERY here because KILL QUERY targets the
      // connection thread, not a specific query. On a shared connection, the KILL can
      // race and kill a DIFFERENT query. Server-side KILL is only for explicit user
      // actions (QueryMonitor Kill button).
      const thisQueryId = ++queryIdCounterRef.current
      const thisIpcQueryId = crypto.randomUUID()
      ipcQueryIdRef.current = thisIpcQueryId

      // Pre-register with the running queries monitor
      addRunningQuery({
        queryId: thisIpcQueryId,
        sqlSessionId,
        query: trimmed.length > 200 ? trimmed.slice(0, 200) + '…' : trimmed,
        startedAt: Date.now(),
        source: 'editor',
      })

      setIsLoading(true)
      setError(null)
      setQueryError(null)

      const startTime = performance.now()

      try {
        const res = await (window as any).novadeck.sql.query(sqlSessionId, trimmed, undefined, thisIpcQueryId)

        // Race guard — a newer query may have started while we were awaiting
        if (thisQueryId !== queryIdCounterRef.current) return

        const execTime = Math.round(performance.now() - startTime)

        // IPC returns { success, data, error }
        if (!res.success) {
          const errMsg = typeof res.error === 'string' ? res.error : res.error?.message ?? 'Query failed'
          // Don't show "Query cancelled" as an error — it was intentional
          if (errMsg === 'Query cancelled') return
          const qError: QueryError = {
            message: errMsg,
            code: res.error?.code,
            line: res.error?.line,
            position: res.error?.position,
          }
          setError(qError)
          setQueryError(qError)
        } else {
          const data = res.data
          const queryResult: QueryResult = {
            fields: data.fields ?? [],
            rows: data.rows ?? [],
            rowCount: data.rows?.length ?? 0,
            affectedRows: data.affectedRows,
            executionTimeMs: data.executionTimeMs ?? execTime,
            truncated: data.truncated ?? false,
          }
          setResult(queryResult)
        }
      } catch (err) {
        if (thisQueryId !== queryIdCounterRef.current) return
        const message = err instanceof Error ? err.message : String(err)
        if (message === 'Query cancelled') return
        const qError: QueryError = { message }
        setError(qError)
        setQueryError(qError)
      } finally {
        if (thisQueryId === queryIdCounterRef.current) {
          setIsLoading(false)
        }
      }
    },
    [connectionId, sqlSessionId, setQueryError, addRunningQuery]
  )

  // ── Run full query ──
  const handleRun = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const selection = editor.getSelection()
    const selectedText = selection && !selection.isEmpty()
      ? editor.getModel()?.getValueInRange(selection) ?? ''
      : ''
    const query = selectedText || editor.getValue()
    executeQuery(query)
  }, [executeQuery])

  // ── Run selected text only ──
  const handleRunSelected = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const selection = editor.getSelection()
    if (!selection || selection.isEmpty()) return
    const selectedText = editor.getModel()?.getValueInRange(selection) ?? ''
    if (selectedText.trim()) executeQuery(selectedText)
  }, [executeQuery])

  // Refs to avoid stale closures in Monaco keybindings (registered once on mount)
  const handleRunRef = useRef(handleRun)
  handleRunRef.current = handleRun
  const handleRunSelectedRef = useRef(handleRunSelected)
  handleRunSelectedRef.current = handleRunSelected

  // ── Monaco mount ──
  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor
      monacoRef.current = monaco

      defineShellwayTheme(monaco)
      monaco.editor.setTheme('shellway-dark')

      // Register autocomplete
      completionDisposableRef.current = registerSQLCompletionProvider(monaco, getSchema)

      // ── Keybindings ──
      // Use refs so these always call the latest handler, even if sqlSessionId changes
      // Cmd+Enter → Run
      editor.addAction({
        id: 'sql-run-query',
        label: 'Run Query',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: () => handleRunRef.current(),
      })

      // Cmd+Shift+Enter → Run Selected
      editor.addAction({
        id: 'sql-run-selected',
        label: 'Run Selected',
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
        ],
        run: () => handleRunSelectedRef.current(),
      })

      // Focus editor on mount
      editor.focus()
    },
    [getSchema] // No longer depends on handleRun/handleRunSelected — uses refs
  )

  // ── Editor content change (debounced) ──
  const handleEditorChange: OnChange = useCallback(
    (value) => {
      if (value !== undefined) debouncedSetQuery(value)
    },
    [debouncedSetQuery]
  )

  // ── Cleanup autocomplete on unmount ──
  useEffect(() => {
    return () => {
      completionDisposableRef.current?.dispose()
      // Reset query ref — stale results discarded via queryIdCounterRef guard.
      // No server-side KILL: see comment in executeQuery.
      ipcQueryIdRef.current = null
    }
  }, [])

  // ── Sort handler for DataGrid ──
  const handleSort = useCallback((_column: string | null, _direction: 'asc' | 'desc') => {
    // In query editor, sorting is a client-side display concern.
    // DataGrid handles its own sorting via ag-grid.
  }, [])

  // ── Load query from history ──
  const handleSelectHistoryQuery = useCallback((query: string) => {
    const editor = editorRef.current
    if (editor) {
      editor.setValue(query)
      setCurrentQuery(query)
    }
    setShowHistory(false)
  }, [setCurrentQuery])

  // Lazy-import QueryHistoryPanel and ExportDialog to keep initial bundle small
  const QueryHistoryPanel = useMemo(
    () => React.lazy(() => import('@/components/sql/QueryHistoryPanel')),
    []
  )
  const ExportDialog = useMemo(
    () => React.lazy(() => import('@/components/sql/ExportDialog')),
    []
  )

  // ── Editor panel ──
  const editorPanel = (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-nd-border bg-nd-bg-secondary shrink-0">
        <Button
          variant="primary"
          size="sm"
          onClick={handleRun}
          disabled={isLoading}
          title="Run Query (Cmd+Enter)"
        >
          {isLoading ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          Run
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRunSelected}
          disabled={isLoading}
          title="Run Selected (Cmd+Shift+Enter)"
        >
          <PlayCircle size={13} />
          Run Selected
        </Button>
      </div>

      {/* Monaco editor */}
      <div className="flex-1 min-h-0">
        <Editor
          defaultLanguage="sql"
          theme="shellway-dark"
          options={EDITOR_OPTIONS}
          onMount={handleEditorMount}
          onChange={handleEditorChange}
          loading={
            <div className="flex items-center justify-center h-full text-nd-text-muted text-sm">
              Loading editor...
            </div>
          }
        />
      </div>
    </div>
  )

  // ── Results panel ──
  const resultsPanel = (
    <div className="flex flex-col h-full">
      <ResultsHeader
        result={result}
        error={error}
        isLoading={isLoading}
        onExport={() => setShowExport(true)}
        onHistory={() => setShowHistory(true)}
      />
      {error && <ErrorBanner error={error} />}
      <div className="flex-1 min-h-0">
        {result && result.rowCount > 0 ? (
          <DataGrid
            result={result}
            onSort={handleSort}
            isLoading={isLoading}
          />
        ) : (
          !error &&
          !isLoading && (
            <div className="flex items-center justify-center h-full text-nd-text-muted text-sm">
              Run a query to see results
            </div>
          )
        )}
      </div>

      {/* History panel (lazy) */}
      {showHistory && (
        <React.Suspense fallback={null}>
          <QueryHistoryPanel
            connectionId={connectionId}
            sqlSessionId={sqlSessionId}
            onSelectQuery={handleSelectHistoryQuery}
            onClose={() => setShowHistory(false)}
          />
        </React.Suspense>
      )}

      {/* Export dialog (lazy) */}
      {showExport && result && (
        <React.Suspense fallback={null}>
          <ExportDialog
            result={result}
            dbType={dbType}
            onClose={() => setShowExport(false)}
          />
        </React.Suspense>
      )}
    </div>
  )

  return (
    <Splitter
      direction="vertical"
      defaultSplit={55}
      minSize={100}
      left={editorPanel}
      right={resultsPanel}
      className="h-full"
    />
  )
})

export default QueryEditor
