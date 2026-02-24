import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Copy, Trash2, Code2, AlignJustify } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useSQLConnection } from '@/stores/sqlStore'
import type { QueryHistoryEntry } from '@/types/sql'

// ── SQL syntax highlighting ──

/** SQL keywords to highlight */
const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'AS', 'ON', 'JOIN',
  'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'FULL', 'NATURAL',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'DROP', 'CREATE',
  'ALTER', 'TABLE', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA',
  'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'ASC', 'DESC',
  'DISTINCT', 'ALL', 'UNION', 'EXCEPT', 'INTERSECT',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'IF', 'EXISTS',
  'IS', 'NULL', 'LIKE', 'BETWEEN', 'TRUE', 'FALSE',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'UNIQUE',
  'DEFAULT', 'AUTO_INCREMENT', 'CASCADE', 'RESTRICT',
  'GRANT', 'REVOKE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION',
  'WITH', 'RECURSIVE', 'TEMPORARY', 'TEMP', 'REPLACE',
  'EXPLAIN', 'ANALYZE', 'SHOW', 'DESCRIBE', 'USE',
  'INFORMATION_SCHEMA',
])

const SQL_FUNCTIONS = new Set([
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'IFNULL', 'NULLIF',
  'CONCAT', 'SUBSTRING', 'LENGTH', 'TRIM', 'UPPER', 'LOWER', 'REPLACE',
  'NOW', 'CURDATE', 'CURTIME', 'DATE', 'TIME', 'YEAR', 'MONTH', 'DAY',
  'CAST', 'CONVERT', 'FORMAT',
  'TABLE_ROWS', 'TABLE_NAME', 'TABLE_SCHEMA',
])

/**
 * Tokenize a SQL string into highlighted spans.
 * Returns an array of React elements.
 */
function highlightSQL(sql: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = []
  // Regex to match strings, backtick-quoted identifiers, numbers, words, and everything else
  const regex = /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b|--[^\n]*|\/\*[\s\S]*?\*\/|[^\s]|\s+)/g
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(sql)) !== null) {
    const token = match[0]
    key++

    // Comments
    if (token.startsWith('--') || token.startsWith('/*')) {
      tokens.push(<span key={key} className="text-nd-text-muted/50 italic">{token}</span>)
    }
    // Strings (single or double quoted)
    else if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) {
      tokens.push(<span key={key} className="text-green-400">{token}</span>)
    }
    // Backtick identifiers
    else if (token.startsWith('`') && token.endsWith('`')) {
      tokens.push(<span key={key} className="text-cyan-400">{token}</span>)
    }
    // Numbers
    else if (/^\d+(?:\.\d+)?$/.test(token)) {
      tokens.push(<span key={key} className="text-amber-400">{token}</span>)
    }
    // Keywords / functions
    else if (/^[A-Za-z_]\w*$/.test(token)) {
      const upper = token.toUpperCase()
      if (SQL_KEYWORDS.has(upper)) {
        tokens.push(<span key={key} className="text-purple-400 font-semibold">{token}</span>)
      } else if (SQL_FUNCTIONS.has(upper)) {
        tokens.push(<span key={key} className="text-blue-400">{token}</span>)
      } else {
        tokens.push(<span key={key}>{token}</span>)
      }
    }
    // Operators and punctuation
    else if (/^[*=<>!+\-/%&|^~]+$/.test(token)) {
      tokens.push(<span key={key} className="text-nd-text-muted">{token}</span>)
    }
    else {
      tokens.push(<span key={key}>{token}</span>)
    }
  }

  return tokens
}

// ── Compact SQL (collapse whitespace into single line) ──

/** Collapse all whitespace (newlines, tabs, multiple spaces) into single spaces */
function compactSQL(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

// ── Log entry ──

interface LogEntryProps {
  entry: QueryHistoryEntry
  syntaxHighlight: boolean
  beauty: boolean
}

const LogEntry = React.memo(function LogEntry({ entry, syntaxHighlight, beauty }: LogEntryProps) {
  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(entry.query).catch(() => {})
  }, [entry.query])

  const displayQuery = useMemo(
    () => beauty ? entry.query : compactSQL(entry.query),
    [entry.query, beauty]
  )

  const highlighted = useMemo(
    () => syntaxHighlight ? highlightSQL(displayQuery) : null,
    [displayQuery, syntaxHighlight]
  )

  const timeStr = useMemo(() => {
    const d = new Date(entry.executedAt)
    return d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 1,
    } as Intl.DateTimeFormatOptions)
  }, [entry.executedAt])

  return (
    <div
      className={cn(
        'group flex items-start gap-2.5 px-2.5 py-1.5 text-2xs font-mono border-b border-nd-border/30 hover:bg-nd-surface/40 transition-colors',
        entry.error && 'bg-red-500/5'
      )}
    >
      {/* Timestamp */}
      <span className="shrink-0 text-nd-text-muted/50 tabular-nums w-[80px] pt-0.5 text-[10px] leading-relaxed">
        {timeStr}
      </span>

      {/* Query text */}
      <pre className={cn(
        'flex-1 break-words leading-relaxed min-w-0 text-[11px]',
        beauty ? 'whitespace-pre-wrap' : 'whitespace-normal',
        entry.error ? 'text-red-400' : !syntaxHighlight ? 'text-nd-text-primary' : ''
      )}>
        {syntaxHighlight && !entry.error ? highlighted : displayQuery}
      </pre>

      {/* Meta */}
      <div className="shrink-0 flex items-center gap-1.5 pt-0.5">
        {entry.error ? (
          <span className="flex items-center gap-0.5 text-red-400 text-[10px]" title={entry.error}>
            <AlertCircle size={9} />
            ERR
          </span>
        ) : (
          <>
            {entry.rowCount !== undefined && (
              <span className="text-nd-text-muted text-[10px]">{entry.rowCount}r</span>
            )}
            <span className="text-nd-text-muted tabular-nums text-[10px]">{Math.round(entry.executionTimeMs)}ms</span>
          </>
        )}

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="p-0.5 rounded text-nd-text-muted/30 hover:text-nd-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
          title="Copy query"
        >
          <Copy size={10} />
        </button>
      </div>
    </div>
  )
})

// ── Toolbar ──

interface QueryLogToolbarProps {
  entryCount: number
  syntaxHighlight: boolean
  beauty: boolean
  onToggleHighlight: () => void
  onToggleBeauty: () => void
  onClear: () => void
}

function QueryLogToolbar({ entryCount, syntaxHighlight, beauty, onToggleHighlight, onToggleBeauty, onClear }: QueryLogToolbarProps) {
  return (
    <div className="flex items-center justify-between px-2.5 py-1 border-b border-nd-border/50 bg-nd-bg-secondary shrink-0">
      <span className="text-[10px] text-nd-text-muted font-medium">
        Query Log
        {entryCount > 0 && <span className="ml-1.5 text-nd-text-muted/50">({entryCount})</span>}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={onToggleHighlight}
          className={cn(
            'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors',
            syntaxHighlight
              ? 'text-nd-accent bg-nd-accent/10'
              : 'text-nd-text-muted hover:text-nd-text-secondary hover:bg-nd-surface'
          )}
          title={syntaxHighlight ? 'Disable syntax highlighting' : 'Enable syntax highlighting'}
        >
          <Code2 size={10} />
          Highlight
        </button>
        <button
          onClick={onToggleBeauty}
          className={cn(
            'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors',
            beauty
              ? 'text-nd-accent bg-nd-accent/10'
              : 'text-nd-text-muted hover:text-nd-text-secondary hover:bg-nd-surface'
          )}
          title={beauty ? 'Show compact (single-line) queries' : 'Show formatted (multi-line) queries'}
        >
          <AlignJustify size={10} />
          Beauty
        </button>
        <button
          onClick={onClear}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-nd-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Clear query log"
        >
          <Trash2 size={10} />
          Clear
        </button>
      </div>
    </div>
  )
}

// ── Component ──

interface SQLQueryLogProps {
  connectionId: string
}

export function SQLQueryLog({ connectionId }: SQLQueryLogProps) {
  const { history, clearHistory } = useSQLConnection(connectionId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const wasAtBottomRef = useRef(true)
  const [syntaxHighlight, setSyntaxHighlight] = useState(true)
  const [beauty, setBeauty] = useState(false)

  // Auto-scroll to bottom when new entries arrive (if already at bottom)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [history.length])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    wasAtBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 20
  }, [])

  const handleClear = useCallback(() => {
    clearHistory()
  }, [clearHistory])

  const handleToggleHighlight = useCallback(() => {
    setSyntaxHighlight((v) => !v)
  }, [])

  const handleToggleBeauty = useCallback(() => {
    setBeauty((v) => !v)
  }, [])

  // Show newest at bottom (chronological)
  const sorted = useMemo(
    () => history.slice().sort((a, b) => a.executedAt - b.executedAt),
    [history]
  )

  return (
    <div className="h-full flex flex-col">
      <QueryLogToolbar
        entryCount={sorted.length}
        syntaxHighlight={syntaxHighlight}
        beauty={beauty}
        onToggleHighlight={handleToggleHighlight}
        onToggleBeauty={handleToggleBeauty}
        onClear={handleClear}
      />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0"
      >
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-full text-nd-text-muted text-xs">
            No queries executed yet
          </div>
        ) : (
          sorted.map((entry) => (
            <LogEntry key={entry.id} entry={entry} syntaxHighlight={syntaxHighlight} beauty={beauty} />
          ))
        )}
      </div>
    </div>
  )
}
