import React, {
  useRef,
  useCallback,
  useState,
  useEffect,
  useMemo,
} from "react";
import Editor, {
  loader,
  type OnMount,
  type OnChange,
} from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import type * as MonacoEditor from "monaco-editor";

// Configure Monaco to use locally bundled files instead of CDN
// This is critical for Electron — CDN may be blocked or unavailable
loader.config({ monaco });

// Configure Monaco web workers for Vite bundling
self.MonacoEnvironment = {
  getWorker(_: unknown, _label: string) {
    return new Worker(
      new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url),
      { type: "module" },
    );
  },
};
import { Play, PlayCircle, History, Download, Loader2, Sparkles, Gauge, GitBranch, Check, Undo2 } from "lucide-react";
import { format as formatSQL, type FormatOptionsWithLanguage } from "sql-formatter";
import { cn } from "@/utils/cn";
import { Button } from "@/components/ui/Button";
import { Splitter } from "@/components/ui/Splitter";
import { DataGrid } from "@/components/sql/DataGrid";
import { registerSQLCompletionProvider } from "@/components/sql/sqlAutocomplete";
import { useSQLConnection } from "@/stores/sqlStore";
import { saveQueryAtIndex, appendSavedQuery } from "@/utils/savedQueries";
import type { QueryResult, QueryError, DatabaseType } from "@/types/sql";

// ── Props ──

interface QueryEditorProps {
  connectionId: string;
  sqlSessionId: string;
  dbType: DatabaseType;
  /** Pre-loaded query content from the saved queries stack */
  initialQuery?: string;
  /** Index into the saved-queries stack for persistence (-1 = new/unassigned) */
  savedQueryIndex?: number;
}

// ── Shellway dark theme definition ──

function defineShellwayTheme(monaco: typeof MonacoEditor) {
  monaco.editor.defineTheme("shellway-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "38bdf8", fontStyle: "bold" },
      { token: "string", foreground: "86efac" },
      { token: "number", foreground: "fbbf24" },
      { token: "comment", foreground: "64748b", fontStyle: "italic" },
      { token: "operator", foreground: "e2e8f0" },
      { token: "predefined", foreground: "c084fc" },
    ],
    colors: {
      "editor.background": "#0f1117",
      "editor.foreground": "#e2e8f0",
      "editor.lineHighlightBackground": "#1e293b40",
      "editor.selectionBackground": "#38bdf830",
      "editorCursor.foreground": "#38bdf8",
      "editorGutter.background": "#0f1117",
      "editorLineNumber.foreground": "#475569",
      "editorLineNumber.activeForeground": "#94a3b8",
      "editor.inactiveSelectionBackground": "#38bdf815",
    },
  });
}

// ── Monaco editor options ──

const EDITOR_OPTIONS: MonacoEditor.editor.IStandaloneEditorConstructionOptions =
  {
    language: "sql",
    theme: "shellway-dark",
    minimap: { enabled: false },
    fontSize: 13,
    lineNumbers: "on",
    tabSize: 2,
    insertSpaces: true,
    wordWrap: "on",
    scrollBeyondLastLine: false,
    automaticLayout: true,
    suggestOnTriggerCharacters: true,
    quickSuggestions: true,
    padding: { top: 8 },
    renderLineHighlight: "line",
    matchBrackets: "always",
    folding: true,
    glyphMargin: false,
  };

// ── Debounce helper ──

function useDebouncedCallback<T extends (...args: never[]) => void>(
  fn: T,
  delay: number,
): T {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  // Cleanup pending timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return useCallback(
    ((...args: never[]) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => fnRef.current(...args), delay);
    }) as T,
    [delay],
  );
}

// ── Results Header ──

interface ResultsHeaderProps {
  result: QueryResult | null;
  error: QueryError | null;
  isLoading: boolean;
  onExport: () => void;
  onHistory: () => void;
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
              {result.rowCount.toLocaleString()}{" "}
              {result.rowCount === 1 ? "row" : "rows"}
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
        <Button
          variant="ghost"
          size="icon"
          onClick={onHistory}
          title="Query History"
        >
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
  );
});

// ── Error banner ──

const ErrorBanner = React.memo(function ErrorBanner({
  error,
}: {
  error: QueryError;
}) {
  return (
    <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/30 text-xs text-red-400 font-mono whitespace-pre-wrap">
      {error.code && <span className="font-semibold">[{error.code}] </span>}
      {error.message}
      {error.line && (
        <span className="ml-2 text-red-500/60">
          (line {error.line}
          {error.position ? `, col ${error.position}` : ""})
        </span>
      )}
    </div>
  );
});

// ── Main Component ──

export const QueryEditor = React.memo(function QueryEditor({
  connectionId,
  sqlSessionId,
  dbType,
  initialQuery,
  savedQueryIndex,
}: QueryEditorProps) {
  const editorRef = useRef<MonacoEditor.editor.IStandaloneCodeEditor | null>(
    null,
  );
  const monacoRef = useRef<typeof MonacoEditor | null>(null);
  const completionDisposableRef = useRef<MonacoEditor.IDisposable | null>(null);

  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<QueryError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showExport, setShowExport] = useState(false);

  // Transaction mode — runs BEGIN on the dedicated userConn and waits for
  // the user to explicitly COMMIT or ROLLBACK. The userConn is already
  // isolated from the data-tab shared connection, so transaction state
  // only affects queries issued from this editor.
  const [inTransaction, setInTransaction] = useState(false);
  const [txnBusy, setTxnBusy] = useState(false);

  // User-configurable per-query timeout (seconds). 0 = unlimited.
  // Persisted globally (not per-connection) — behaves as a sanity net
  // shared across all query tabs.
  const QUERY_TIMEOUT_STORAGE_KEY = "sql-query-timeout-secs";
  const [queryTimeoutSecs, setQueryTimeoutSecs] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(QUERY_TIMEOUT_STORAGE_KEY);
      const parsed = raw ? Number.parseInt(raw, 10) : 0;
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    } catch {
      return 0;
    }
  });
  const queryTimeoutRef = useRef(queryTimeoutSecs);
  queryTimeoutRef.current = queryTimeoutSecs;
  const persistQueryTimeout = useCallback((secs: number) => {
    setQueryTimeoutSecs(secs);
    try {
      localStorage.setItem(QUERY_TIMEOUT_STORAGE_KEY, String(secs));
    } catch {}
  }, []);

  // Race condition protection — prevents stale results from overwriting newer ones
  const queryIdCounterRef = useRef(0);
  const ipcQueryIdRef = useRef<string | null>(null);

  // Store selectors (scoped to this connection)
  const {
    tables,
    columns,
    databases,
    setCurrentQuery,
    setQueryError,
    addRunningQuery,
  } = useSQLConnection(connectionId);

  // Track the saved-query index for this tab (may be assigned on mount or created later)
  const savedIndexRef = useRef(savedQueryIndex ?? -1);

  // Debounced store sync — avoid updating store on every keystroke
  const debouncedSetQuery = useDebouncedCallback(
    (value: string) => {
      setCurrentQuery(value);
      // Persist to saved-queries stack in localStorage
      const trimmed = value.trim();
      if (trimmed) {
        if (savedIndexRef.current >= 0) {
          // Update existing slot
          saveQueryAtIndex(connectionId, savedIndexRef.current, trimmed);
        } else {
          // First meaningful content in a new tab — append to stack
          savedIndexRef.current = appendSavedQuery(connectionId, trimmed);
        }
      }
    },
    300,
  );

  // Schema getter for autocomplete (stable ref to avoid re-registering)
  const getSchema = useCallback(
    () => ({
      tables,
      columns,
      databases: databases.map((d) => d.name),
    }),
    [tables, columns, databases],
  );

  // ── Execute query via IPC (with race condition protection) ──
  const executeQuery = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;

      // Race protection — increment counter so stale results are discarded.
      // We do NOT send server-side KILL QUERY here because KILL QUERY targets the
      // connection thread, not a specific query. On a shared connection, the KILL can
      // race and kill a DIFFERENT query. Server-side KILL is only for explicit user
      // actions (QueryMonitor Kill button).
      const thisQueryId = ++queryIdCounterRef.current;
      const thisIpcQueryId = crypto.randomUUID();
      ipcQueryIdRef.current = thisIpcQueryId;

      // Pre-register with the running queries monitor
      addRunningQuery({
        queryId: thisIpcQueryId,
        sqlSessionId,
        query: trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed,
        startedAt: Date.now(),
        source: "editor",
      });

      setIsLoading(true);
      setError(null);
      setQueryError(null);

      const startTime = performance.now();

      // Optional client-side timeout. When it fires we call the existing
      // server-side cancelQuery path so the DB stops working on this query
      // rather than letting it run orphaned after we've given up on the
      // result. queryIdCounterRef already discards any late response.
      const timeoutSecs = queryTimeoutRef.current;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let timedOut = false;
      if (timeoutSecs > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          (window as any).novadeck.sql
            .cancelQuery(thisIpcQueryId)
            .catch(() => {});
        }, timeoutSecs * 1000);
      }

      try {
        const res = await (window as any).novadeck.sql.query(
          sqlSessionId,
          trimmed,
          undefined,
          thisIpcQueryId,
          "user",
        );
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (timedOut) {
          if (thisQueryId !== queryIdCounterRef.current) return;
          const qError: QueryError = {
            message: `Query cancelled: timeout exceeded (${timeoutSecs}s). Increase it in the toolbar if needed.`,
          };
          setError(qError);
          setQueryError(qError);
          return;
        }

        // Race guard — a newer query may have started while we were awaiting
        if (thisQueryId !== queryIdCounterRef.current) return;

        const execTime = Math.round(performance.now() - startTime);

        // IPC returns { success, data, error }
        if (!res.success) {
          const errMsg =
            typeof res.error === "string"
              ? res.error
              : (res.error?.message ?? "Query failed");
          // Don't show "Query cancelled" as an error — it was intentional
          if (errMsg === "Query cancelled") return;
          const qError: QueryError = {
            message: errMsg,
            code: res.error?.code,
            line: res.error?.line,
            position: res.error?.position,
          };
          setError(qError);
          setQueryError(qError);
        } else {
          const data = res.data;
          const queryResult: QueryResult = {
            fields: data.fields ?? [],
            rows: data.rows ?? [],
            rowCount: data.rows?.length ?? 0,
            affectedRows: data.affectedRows,
            executionTimeMs: data.executionTimeMs ?? execTime,
            truncated: data.truncated ?? false,
          };
          setResult(queryResult);
        }
      } catch (err) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (thisQueryId !== queryIdCounterRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        if (message === "Query cancelled") return;
        const qError: QueryError = { message };
        setError(qError);
        setQueryError(qError);
      } finally {
        if (thisQueryId === queryIdCounterRef.current) {
          setIsLoading(false);
        }
      }
    },
    [connectionId, sqlSessionId, setQueryError, addRunningQuery],
  );

  // ── Transaction control ──
  // Issue a bare transaction statement on the user connection, surface any
  // server error as a normal query error so the user sees it, and flip the
  // UI state only when the server actually acknowledges the change.
  const runTxnStatement = useCallback(
    async (stmt: "BEGIN" | "COMMIT" | "ROLLBACK"): Promise<boolean> => {
      setTxnBusy(true);
      try {
        const res = await (window as any).novadeck.sql.query(
          sqlSessionId,
          stmt,
          undefined,
          crypto.randomUUID(),
          "user",
        );
        if (!res.success) {
          const message =
            typeof res.error === "string"
              ? res.error
              : (res.error?.message ?? `${stmt} failed`);
          const qError: QueryError = { message };
          setError(qError);
          setQueryError(qError);
          return false;
        }
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const qError: QueryError = { message };
        setError(qError);
        setQueryError(qError);
        return false;
      } finally {
        setTxnBusy(false);
      }
    },
    [sqlSessionId, setQueryError],
  );

  const handleBeginTransaction = useCallback(async () => {
    if (inTransaction || txnBusy) return;
    const ok = await runTxnStatement("BEGIN");
    if (ok) setInTransaction(true);
  }, [inTransaction, txnBusy, runTxnStatement]);

  const handleCommitTransaction = useCallback(async () => {
    if (!inTransaction || txnBusy) return;
    const ok = await runTxnStatement("COMMIT");
    if (ok) setInTransaction(false);
  }, [inTransaction, txnBusy, runTxnStatement]);

  const handleRollbackTransaction = useCallback(async () => {
    if (!inTransaction || txnBusy) return;
    const ok = await runTxnStatement("ROLLBACK");
    if (ok) setInTransaction(false);
  }, [inTransaction, txnBusy, runTxnStatement]);

  // ── Run full query (always runs entire editor content, ignores any selection) ──
  const handleRun = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const query = editor.getValue();
    executeQuery(query);
  }, [executeQuery]);

  // ── Explain the current query (or selection when present) ──
  // Prefixes with EXPLAIN so the user sees the planner's decision without
  // actually running the statement. Never uses ANALYZE — that would execute
  // the query for real, which the user can already do with Run.
  const handleExplain = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = editor.getSelection();
    const selected =
      selection && !selection.isEmpty()
        ? (editor.getModel()?.getValueInRange(selection) ?? "")
        : editor.getValue();
    const trimmed = selected.trim().replace(/;\s*$/, "");
    if (!trimmed) return;
    // Skip prefixing if user already wrote EXPLAIN/DESCRIBE/ANALYZE — let
    // their version through as-is.
    const lead = trimmed.slice(0, 16).toUpperCase();
    const already =
      lead.startsWith("EXPLAIN") ||
      lead.startsWith("DESCRIBE") ||
      lead.startsWith("DESC ") ||
      lead.startsWith("ANALYZE");
    const sql = already ? trimmed : `EXPLAIN ${trimmed}`;
    executeQuery(sql);
  }, [executeQuery]);

  // ── Run selected text only ──
  const handleRunSelected = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) return;
    const selectedText = editor.getModel()?.getValueInRange(selection) ?? "";
    if (selectedText.trim()) executeQuery(selectedText);
  }, [executeQuery]);

  // ── Format query (Beautify via sql-formatter) ──
  // Formats the current selection if non-empty, otherwise the entire editor
  // content. Replaces the target range via a single edit op so Monaco's
  // undo stack treats it as one reversible action.
  const handleFormat = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;

    const selection = editor.getSelection();
    const hasSelection = selection && !selection.isEmpty();
    const targetRange = hasSelection
      ? selection
      : model.getFullModelRange();
    const source = model.getValueInRange(targetRange);
    if (!source.trim()) return;

    const options: FormatOptionsWithLanguage = {
      language: dbType === "mysql" ? "mysql" : "postgresql",
      keywordCase: "upper",
      tabWidth: 2,
      linesBetweenQueries: 2,
    };

    let formatted: string;
    try {
      formatted = formatSQL(source, options);
    } catch {
      // Malformed SQL — sql-formatter throws on tokens it can't parse.
      // Leave the buffer untouched rather than corrupting it.
      return;
    }
    if (formatted === source) return;

    editor.executeEdits("sql-format", [
      { range: targetRange, text: formatted, forceMoveMarkers: true },
    ]);
    editor.pushUndoStop();
  }, [dbType]);

  // Refs to avoid stale closures in Monaco keybindings (registered once on mount)
  const handleRunRef = useRef(handleRun);
  handleRunRef.current = handleRun;
  const handleRunSelectedRef = useRef(handleRunSelected);
  handleRunSelectedRef.current = handleRunSelected;
  const handleFormatRef = useRef(handleFormat);
  handleFormatRef.current = handleFormat;
  const handleExplainRef = useRef(handleExplain);
  handleExplainRef.current = handleExplain;

  // ── Stable ref for schema — lets the Monaco completion provider always read
  // the latest tables/columns/databases without needing to re-register ──
  const getSchemaRef = useRef(getSchema);
  getSchemaRef.current = getSchema;

  // ── Monaco mount ──
  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      defineShellwayTheme(monaco);
      monaco.editor.setTheme("shellway-dark");

      // Register autocomplete — pass a stable wrapper so the provider always
      // calls the latest getSchema even after tables/columns/databases load
      completionDisposableRef.current = registerSQLCompletionProvider(
        monaco,
        () => getSchemaRef.current(),
      );

      // ── Keybindings ──
      // Use refs so these always call the latest handler, even if sqlSessionId changes
      // Cmd+Enter → Run
      editor.addAction({
        id: "sql-run-query",
        label: "Run Query",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: () => handleRunRef.current(),
      });

      // Cmd+Shift+Enter → Run Selected
      editor.addAction({
        id: "sql-run-selected",
        label: "Run Selected",
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
        ],
        run: () => handleRunSelectedRef.current(),
      });

      // Alt+Shift+F → Format (matches VS Code / Monaco default)
      editor.addAction({
        id: "sql-format",
        label: "Format SQL",
        keybindings: [
          monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
        ],
        contextMenuGroupId: "1_modification",
        run: () => handleFormatRef.current(),
      });

      // Cmd+Shift+E → Explain
      editor.addAction({
        id: "sql-explain",
        label: "Explain Query",
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE,
        ],
        run: () => handleExplainRef.current(),
      });

      // Focus editor on mount
      editor.focus();
    },
    [], // Uses refs for all callbacks — no deps needed
  );

  // ── Editor content change (debounced) ──
  const handleEditorChange: OnChange = useCallback(
    (value) => {
      if (value !== undefined) debouncedSetQuery(value);
    },
    [debouncedSetQuery],
  );

  // ── Cleanup autocomplete on unmount ──
  useEffect(() => {
    return () => {
      completionDisposableRef.current?.dispose();
      // Reset query ref — stale results discarded via queryIdCounterRef guard.
      // No server-side KILL: see comment in executeQuery.
      ipcQueryIdRef.current = null;
    };
  }, []);

  // ── Sort handler for DataGrid ──
  const handleSort = useCallback(
    (_keys: Array<{ column: string; direction: "asc" | "desc" }>) => {
      // In query editor, sorting is a client-side display concern.
      // DataGrid handles its own sorting via ag-grid.
    },
    [],
  );

  // ── Load query from history ──
  const handleSelectHistoryQuery = useCallback(
    (query: string) => {
      const editor = editorRef.current;
      if (editor) {
        editor.setValue(query);
        setCurrentQuery(query);
      }
      setShowHistory(false);
    },
    [setCurrentQuery],
  );

  // Lazy-import QueryHistoryPanel and ExportDialog to keep initial bundle small
  const QueryHistoryPanel = useMemo(
    () => React.lazy(() => import("@/components/sql/QueryHistoryPanel")),
    [],
  );
  const ExportDialog = useMemo(
    () => React.lazy(() => import("@/components/sql/ExportDialog")),
    [],
  );

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
          {isLoading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Play size={13} />
          )}
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
        <Button
          variant="ghost"
          size="sm"
          onClick={handleFormat}
          title="Format SQL (Alt+Shift+F)"
        >
          <Sparkles size={13} />
          Format
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleExplain}
          disabled={isLoading}
          title="Show query plan without executing (Cmd+Shift+E)"
        >
          <Gauge size={13} />
          Explain
        </Button>
        {/* Transaction controls — moved to after Explain, before Timeout */}
        {!inTransaction ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBeginTransaction}
            disabled={isLoading || txnBusy}
            title="Begin an explicit transaction on this editor's connection"
          >
            <GitBranch size={13} />
            Begin Txn
          </Button>
        ) : (
          <>
            <span
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-md border border-amber-400/40 bg-amber-500/10 text-amber-300 font-medium"
              title="An uncommitted transaction is open on this connection"
            >
              <GitBranch size={11} />
              Txn open
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCommitTransaction}
              disabled={txnBusy}
              title="Commit the open transaction"
            >
              <Check size={13} />
              Commit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRollbackTransaction}
              disabled={txnBusy}
              title="Roll back the open transaction"
            >
              <Undo2 size={13} />
              Rollback
            </Button>
          </>
        )}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-nd-text-muted">
          <label
            htmlFor="sql-query-timeout"
            title="Cancel the query after this many seconds. 0 = no limit."
            className="cursor-help"
          >
            Timeout
          </label>
          <input
            id="sql-query-timeout"
            type="number"
            min={0}
            step={1}
            value={queryTimeoutSecs}
            onChange={(e) => {
              const raw = Number.parseInt(e.target.value, 10);
              persistQueryTimeout(
                Number.isFinite(raw) && raw >= 0 ? raw : 0,
              );
            }}
            className="w-16 px-1.5 py-0.5 text-xs rounded border border-nd-border bg-nd-bg-primary text-nd-text-primary focus:outline-none focus:ring-1 focus:ring-nd-accent"
          />
          <span>s</span>
        </div>
      </div>

      {/* Monaco editor */}
      <div className="flex-1 min-h-0">
        <Editor
          defaultLanguage="sql"
          defaultValue={initialQuery}
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
  );

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
          <DataGrid result={result} onSort={handleSort} isLoading={isLoading} />
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
  );

  return (
    <Splitter
      direction="vertical"
      defaultSplit={55}
      minSize={100}
      left={editorPanel}
      right={resultsPanel}
      className="h-full"
    />
  );
});

export default QueryEditor;
